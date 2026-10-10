"""Running and recording an evaluation (Phase 09).

`run_evaluation` reads one channel's data, evaluates it (`evaluate.py`), and
records the result: the full evaluation as JSON in the raw bucket, an
`eval_runs` row validated against the exported schema, one Experiments run
per audience, and one plot per test video. Evaluation models are never
written to `model_runs`, so nothing can publish them.
"""

import uuid
from collections.abc import Callable, Mapping, Sequence
from dataclasses import asdict, dataclass, field
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any, Protocol

from soundcheck_modeling.contract import ModelConfig, validate_eval_run
from soundcheck_modeling.data import (
    AUDIENCES,
    ChannelContext,
    Floats,
    TrainingTable,
    VideoInfo,
)
from soundcheck_modeling.evaluate import Evaluation, evaluate_channel
from soundcheck_modeling.experiments import ExperimentLog, run_name
from soundcheck_modeling.plots import plot_video

DEFAULT_PLOTS = Path(__file__).resolve().parents[4] / "docs" / "eval"


class EvaluationSource(Protocol):
    def training_table(self, feature_version: str, channel: str | None) -> TrainingTable: ...

    def channel_contexts(self, feature_version: str) -> dict[str, ChannelContext]: ...

    def videos(self, channel: str) -> list[VideoInfo]: ...

    def view_percentages(self, channel: str) -> dict[tuple[str, str], float]: ...

    def llm_curves(self, channel: str) -> dict[str, Floats]: ...

    def latest_model_run(
        self, channel: str, model_version: str, feature_version: str
    ) -> str | None: ...


class EvaluationStore(Protocol):
    def save_json(self, path: str, value: Mapping[str, Any]) -> str: ...

    def append_eval_run(self, row: Mapping[str, Any]) -> None: ...


def evaluation_details(evaluation: Evaluation) -> dict[str, Any]:
    """The evaluation as JSON-safe data, without the curves (those are in the plots)."""
    audiences = {}
    for name, result in evaluation.audiences.items():
        audiences[name] = {
            "videos": [
                {
                    "video_id": v.video_id,
                    "duration_s": v.duration_s,
                    "scores": {k: asdict(s) for k, s in v.scores.items()},
                    "actual_avg_pp": v.actual_avg_pp,
                    "predicted_avg_pp": v.predicted_avg_pp,
                    "coverage": v.coverage,
                    "youtube_avp": v.youtube_avp,
                }
                for v in result.videos
            ],
            "lambdas": result.lambdas,
            "not_converged": result.not_converged,
            "b0_variant": result.b0_variant,
            "summary": result.summary,
            "coverage": result.coverage,
            "inflation": result.inflation,
            "bootstrap": result.bootstrap,
        }
    return {
        "channel_id": evaluation.channel_id,
        "model_version": evaluation.model_version,
        "feature_version": evaluation.feature_version,
        "mode": evaluation.mode,
        "reason": evaluation.reason,
        "as_of": evaluation.as_of,
        "folds": [{"train": f.train, "test": f.test} for f in evaluation.folds],
        "too_new": evaluation.too_new,
        "audiences": audiences,
    }


@dataclass
class EvaluationOutcome:
    run_id: str
    status: str  # holdout | check | failed
    details: dict[str, Any]
    plots: list[Path] = field(default_factory=list)
    error: str | None = None


@dataclass
class Evaluator:
    source: EvaluationSource
    store: EvaluationStore
    experiments: ExperimentLog
    config: ModelConfig
    min_train_videos: int
    plots_dir: Path = DEFAULT_PLOTS
    now: Callable[[], datetime] = field(default=lambda: datetime.now(UTC))

    def run(self, channel: str, audiences: Sequence[str] = AUDIENCES) -> EvaluationOutcome:
        started = self.now()
        run_id = uuid.uuid4().hex
        production = self.source.latest_model_run(
            channel, self.config.model_version, self.config.feature_version
        )
        try:
            evaluation = self._evaluate(channel, audiences)
        except Exception as error:  # recorded as a failed evaluation
            self._record(channel, run_id, production, "failed", {"error": str(error)}, started)
            return EvaluationOutcome(run_id, "failed", {"error": str(error)}, error=str(error))

        details = evaluation_details(evaluation)
        details["min_train_videos"] = self.min_train_videos
        details["production_run_id"] = production
        details["evaluation_uri"] = self.store.save_json(
            f"{channel}/evals/{run_id}/evaluation.json", details
        )
        details["experiment_runs"] = self._log(channel, run_id, evaluation)
        plots = [
            plot_video(evaluation, video, self.plots_dir / channel)
            for video in sorted(
                {v.video_id for r in evaluation.audiences.values() for v in r.videos}
            )
        ]
        self._record(channel, run_id, production, evaluation.mode, details, started)
        return EvaluationOutcome(run_id, evaluation.mode, details, plots)

    def _evaluate(self, channel: str, audiences: Sequence[str]) -> Evaluation:
        context = self.source.channel_contexts(self.config.feature_version).get(channel)
        if context is None or context.as_of is None:
            raise RuntimeError(
                f"No feature context for {channel} at {self.config.feature_version}: "
                "run `soundcheck features --channel` first"
            )
        table = self.source.training_table(self.config.feature_version, channel)
        if table.rows == 0:
            raise RuntimeError(f"No training rows for {channel} at {self.config.feature_version}")
        return evaluate_channel(
            channel_id=channel,
            table=table,
            videos=self.source.videos(channel),
            as_of=date.fromisoformat(context.as_of),
            config=self.config,
            min_train_videos=self.min_train_videos,
            pooled=self.source.training_table(self.config.feature_version, None),
            llm_curves=self.source.llm_curves(channel),
            view_percentages=self.source.view_percentages(channel),
            audiences=audiences,
        )

    def _record(
        self,
        channel: str,
        run_id: str,
        production: str | None,
        status: str,
        details: dict[str, Any],
        started: datetime,
    ) -> None:
        row = {
            "run_id": run_id,
            "model_run_id": production or run_id,
            "channel_id": channel,
            "model_version": self.config.model_version,
            "feature_version": self.config.feature_version,
            "status": status,
            "started_at": started.isoformat(),
            "finished_at": self.now().isoformat(),
            "details": details,
        }
        validate_eval_run(row)
        self.store.append_eval_run(row)

    def _log(self, channel: str, run_id: str, evaluation: Evaluation) -> dict[str, str]:
        """One Experiments run per audience; a logging failure is recorded, not raised."""
        logged: dict[str, str] = {}
        for audience, result in evaluation.audiences.items():
            if not result.summary:
                continue
            name = run_name(f"eval-{channel}", audience, run_id)
            metrics: dict[str, float] = {}
            for contender, summary in result.summary.items():
                for key in ("curve_mae_pp", "retention_error_pp", "drop_hit_rate"):
                    value = summary[key]
                    if value is not None:
                        metrics[f"{contender}_{key}"] = value
            if result.coverage is not None:
                metrics["coverage_80"] = result.coverage
            if result.bootstrap is not None:
                metrics["model_minus_b0_pp"] = float(result.bootstrap["mean_difference_pp"])
                metrics["model_minus_b0_low"] = float(result.bootstrap["low"])
                metrics["model_minus_b0_high"] = float(result.bootstrap["high"])
            try:
                self.experiments.log(
                    name,
                    {
                        "channel": channel,
                        "audience": audience,
                        "mode": evaluation.mode,
                        "model_version": evaluation.model_version,
                        "feature_version": evaluation.feature_version,
                        "test_videos": len(result.videos),
                        "b0_variant": result.b0_variant,
                    },
                    metrics,
                )
                logged[audience] = name
            except Exception as error:  # the evaluation stands without its experiment log
                logged[audience] = f"{name} (not logged: {error})"
        return logged

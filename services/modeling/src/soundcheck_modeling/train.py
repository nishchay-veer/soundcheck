"""Training the per-audience hazard models (Phase 08).

`train_pooled` fits one model per audience across every channel with a small
penalty; `train_channel` fits a channel's models, shrunk toward the pooled
coefficients (empirical-Bayes shrinkage) when the pooled model is usable, and
toward 0 otherwise. Every fit writes a `model_runs` row and an experiment run;
a converged fit also writes its artifact, validated first. A model that did
not converge is never written.
"""

import uuid
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Protocol

import numpy as np

from soundcheck_modeling.contract import (
    POOLED_CHANNEL,
    ModelConfig,
    validate_artifact,
    validate_model_run,
)
from soundcheck_modeling.data import ChannelContext, Floats, TrainingTable
from soundcheck_modeling.experiments import ExperimentLog, run_name
from soundcheck_modeling.fit import CrossValidation, Fit, cross_validate, fit_model, video_weights

# A prior is only an average when it averages at least this many channels.
MIN_POOLED_CHANNELS = 2


class Source(Protocol):
    def training_table(self, feature_version: str, channel: str | None) -> TrainingTable: ...

    def channel_contexts(self, feature_version: str) -> dict[str, ChannelContext]: ...


class Store(Protocol):
    def save_artifact(self, path: str, artifact: Mapping[str, Any]) -> str: ...

    def load_artifact(self, uri: str) -> dict[str, Any]: ...

    def append_model_run(self, row: Mapping[str, Any]) -> None: ...

    def latest_pooled_uri(
        self, audience: str, model_version: str, feature_version: str
    ) -> str | None: ...


@dataclass(frozen=True)
class Outcome:
    audience: str
    status: str  # fitted | not_converged | no_data | failed
    artifact_uri: str | None = None
    usable: bool = False
    reasons: list[str] = field(default_factory=list)
    lam: float | None = None
    rows: int = 0
    videos: int = 0
    error: str | None = None


@dataclass(frozen=True)
class AudienceRows:
    x: Floats
    names: list[str]
    h: Floats
    w: Floats
    videos: list[str]
    channels: list[str]


def audience_rows(table: TrainingTable, audience: str, columns: Sequence[str]) -> AudienceRows:
    """One audience's rows, the model's columns of x, and their weights."""
    missing = [name for name in columns if name not in table.names]
    if missing:
        raise ValueError(f"Columns not in {table.feature_version}: {', '.join(missing)}")
    rows = np.flatnonzero(np.asarray(table.audience) == audience)
    videos = [table.video[i] for i in rows]
    return AudienceRows(
        x=table.x[np.ix_(rows, [table.names.index(name) for name in columns])],
        names=list(columns),
        h=table.hazard[rows],
        w=video_weights(videos, table.n_at_risk[rows], table.video_views[rows]),
        videos=videos,
        channels=[table.channel[i] for i in rows],
    )


def _weighted(data: AudienceRows) -> tuple[list[str], list[str]]:
    """The videos and channels that carry weight."""
    videos = sorted({v for v, w in zip(data.videos, data.w, strict=True) if w > 0})
    channels = sorted({c for c, w in zip(data.channels, data.w, strict=True) if w > 0})
    return videos, channels


def _context(context: ChannelContext | None) -> dict[str, Any] | None:
    if context is None:
        return None
    return {"medianTargetLevel": context.median_target_level, "mixMean": dict(context.mix_mean)}


def artifact_document(
    config: ModelConfig,
    *,
    run_id: str,
    channel: str | None,
    audience: str,
    fit: Fit,
    metrics: Mapping[str, Any],
    extraction: str,
    prior_ref: str | None,
    channels: list[str],
    videos: list[str],
    context: ChannelContext | None,
    reasons: list[str],
    created: datetime,
) -> dict[str, Any]:
    """The artifact of a fit, in the shape of TypeScript's `modelArtifactSchema`."""
    return {
        "runId": run_id,
        "channelId": channel,
        "audience": audience,
        "modelVersion": config.model_version,
        "featureVersion": config.feature_version,
        "extractionVersion": extraction,
        "createdAt": created.isoformat(),
        "featureNames": fit.names,
        "droppedFeatures": fit.dropped,
        "unpenalized": [name for name in fit.names if name in config.unpenalized],
        "mean": fit.mean.tolist(),
        "sd": fit.sd.tolist(),
        "alpha": fit.alpha,
        "beta": fit.beta.tolist(),
        "cov": fit.cov.tolist(),
        "lambda": fit.lam,
        "priorRef": prior_ref,
        "trainChannelIds": channels,
        "trainVideoIds": videos,
        "channelContext": _context(context),
        "usable": not reasons,
        "unusableReasons": reasons,
        "metrics": dict(metrics),
    }


@dataclass
class Trainer:
    source: Source
    store: Store
    experiments: ExperimentLog
    config: ModelConfig
    min_train_videos: int
    now: Callable[[], datetime] = field(default=lambda: datetime.now(UTC))

    def train_pooled(self, audiences: Sequence[str]) -> list[Outcome]:
        table = self.source.training_table(self.config.feature_version, None)
        contexts = self.source.channel_contexts(self.config.feature_version)
        run_id = uuid.uuid4().hex
        return [
            self._train(
                run_id=run_id,
                channel=None,
                audience=audience,
                table=table,
                context=None,
                extraction=",".join(sorted({c.extraction_version for c in contexts.values()})),
                prior=None,
            )
            for audience in audiences
        ]

    def train_channel(self, channel: str, audiences: Sequence[str]) -> list[Outcome]:
        table = self.source.training_table(self.config.feature_version, channel)
        context = self.source.channel_contexts(self.config.feature_version).get(channel)
        if context is None:
            raise RuntimeError(
                f"No feature context for {channel} at {self.config.feature_version}: "
                "run `soundcheck features --channel` first (with --force if its rows are current)"
            )
        run_id = uuid.uuid4().hex
        outcomes = []
        for audience in audiences:
            prior: tuple[dict[str, float], str] | None = None
            uri = self.store.latest_pooled_uri(
                audience, self.config.model_version, self.config.feature_version
            )
            if uri is not None:
                pooled = self.store.load_artifact(uri)
                if pooled["usable"]:
                    prior = (
                        {
                            name: b / s
                            for name, b, s in zip(
                                pooled["featureNames"], pooled["beta"], pooled["sd"], strict=True
                            )
                        },
                        uri,
                    )
            outcomes.append(
                self._train(
                    run_id=run_id,
                    channel=channel,
                    audience=audience,
                    table=table,
                    context=context,
                    extraction=context.extraction_version,
                    prior=prior,
                )
            )
        return outcomes

    def _train(
        self,
        *,
        run_id: str,
        channel: str | None,
        audience: str,
        table: TrainingTable,
        context: ChannelContext | None,
        extraction: str,
        prior: tuple[dict[str, float], str] | None,
    ) -> Outcome:
        started = self.now()
        scope = channel or POOLED_CHANNEL
        row: dict[str, Any] = {
            "run_id": run_id,
            "channel_id": scope,
            "audience": audience,
            "model_version": self.config.model_version,
            "feature_version": self.config.feature_version,
            "started_at": started.isoformat(),
        }
        try:
            outcome, details = self._fit(
                run_id, channel, audience, table, context, extraction, prior, started
            )
        # Any failure is recorded as the audience's run, then the next audience runs.
        except Exception as error:
            outcome = Outcome(audience=audience, status="failed", error=str(error))
            details = {"error": str(error)}
        row.update(
            status=outcome.status,
            finished_at=self.now().isoformat(),
            artifact_uri=outcome.artifact_uri,
            details=details,
        )
        validate_model_run(row)
        self.store.append_model_run(row)
        return outcome

    def _fit(
        self,
        run_id: str,
        channel: str | None,
        audience: str,
        table: TrainingTable,
        context: ChannelContext | None,
        extraction: str,
        prior: tuple[dict[str, float], str] | None,
        started: datetime,
    ) -> tuple[Outcome, dict[str, Any]]:
        data = audience_rows(table, audience, self.config.columns[audience])
        videos, channels = _weighted(data)
        if not videos:
            return Outcome(audience=audience, status="no_data"), {"rows": len(data.h)}

        prior_coefficients = prior[0] if prior else None
        if channel is None:
            cv = CrossValidation(losses=[], folds=0, chosen=self.config.pooled_lambda)
        else:
            cv = cross_validate(
                data.x,
                data.names,
                data.h,
                data.w,
                data.videos,
                self.config.lambdas,
                self.config.folds,
                self.config.unpenalized,
                prior_coefficients,
            )
        fit = fit_model(
            data.x,
            data.names,
            data.h,
            data.w,
            cv.chosen,
            self.config.unpenalized,
            prior_coefficients,
        )
        metrics = {
            "rows": len(data.h),
            "videos": len(videos),
            "trainLoss": fit.train_loss,
            "cv": [{"lambda": lam, "loss": loss} for lam, loss in cv.losses],
            "folds": cv.folds,
            "iterations": fit.iterations,
            "converged": fit.converged,
            "gradientNorm": fit.gradient_norm,
        }
        experiment = self._log(channel or POOLED_CHANNEL, audience, run_id, fit, metrics)
        details: dict[str, Any] = {"lambda": fit.lam, **metrics, **experiment}
        if not fit.converged:
            return (
                Outcome(
                    audience=audience,
                    status="not_converged",
                    lam=fit.lam,
                    rows=len(data.h),
                    videos=len(videos),
                ),
                details,
            )

        reasons = []
        if channel is None and len(channels) < MIN_POOLED_CHANNELS:
            reasons.append(
                f"pooled from {len(channels)} channel; a prior needs at least {MIN_POOLED_CHANNELS}"
            )
        if channel is not None and len(videos) < self.min_train_videos:
            reasons.append(
                f"trained on {len(videos)} videos; at least {self.min_train_videos} are needed"
            )
        artifact = artifact_document(
            self.config,
            run_id=run_id,
            channel=channel,
            audience=audience,
            fit=fit,
            metrics=metrics,
            extraction=extraction,
            prior_ref=prior[1] if prior else None,
            channels=channels,
            videos=videos,
            context=context,
            reasons=reasons,
            created=started,
        )
        validate_artifact(artifact)
        uri = self.store.save_artifact(
            f"{channel or POOLED_CHANNEL}/models/{run_id}/{audience}.json", artifact
        )
        details.update(usable=not reasons, unusable_reasons=reasons, prior_ref=artifact["priorRef"])
        return (
            Outcome(
                audience=audience,
                status="fitted",
                artifact_uri=uri,
                usable=not reasons,
                reasons=reasons,
                lam=fit.lam,
                rows=len(data.h),
                videos=len(videos),
            ),
            details,
        )

    def _log(
        self, scope: str, audience: str, run_id: str, fit: Fit, metrics: Mapping[str, Any]
    ) -> dict[str, str]:
        """Logs the fit as an experiment run; a logging failure is recorded, not raised."""
        name = run_name(scope, audience, run_id)
        try:
            self.experiments.log(
                name,
                {
                    "channel": scope,
                    "audience": audience,
                    "model_version": self.config.model_version,
                    "feature_version": self.config.feature_version,
                    "lambda": fit.lam,
                    "columns": len(fit.names),
                    "dropped": len(fit.dropped),
                },
                {
                    "rows": metrics["rows"],
                    "videos": metrics["videos"],
                    "train_loss": metrics["trainLoss"],
                    "iterations": metrics["iterations"],
                    "converged": int(metrics["converged"]),
                    "gradient_norm": metrics["gradientNorm"],
                },
            )
        # The fit stands without its experiment log; the failure is recorded instead.
        except Exception as error:
            return {"experiment_run": name, "experiment_error": str(error)}
        return {"experiment_run": name}

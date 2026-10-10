import json
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from synthetic import AS_OF, CONFIG, channel
from typer.testing import CliRunner

from soundcheck_modeling import cli
from soundcheck_modeling.contract import validate_eval_run
from soundcheck_modeling.data import ChannelContext, Floats, TrainingTable, VideoInfo
from soundcheck_modeling.evaluation_run import Evaluator

CHANNEL = "UCaaaaaaaaaaaaaaaaaaaaaa"


@dataclass
class Source:
    table: TrainingTable
    infos: list[VideoInfo]
    context: bool = True

    def training_table(self, feature_version: str, channel: str | None) -> TrainingTable:
        return self.table

    def channel_contexts(self, feature_version: str) -> dict[str, ChannelContext]:
        if not self.context:
            return {}
        return {
            CHANNEL: ChannelContext("beats-v5", 2.0, {"search": 0.2}, [], as_of=AS_OF.isoformat())
        }

    def videos(self, channel: str) -> list[VideoInfo]:
        return self.infos

    def view_percentages(self, channel: str) -> dict[tuple[str, str], float]:
        return {(self.infos[0].video_id, "subscribed"): 44.0}

    def llm_curves(self, channel: str) -> dict[str, Floats]:
        return {info.video_id: np.linspace(0.95, 0.3, 100) for info in self.infos}

    def latest_model_run(
        self, channel: str, model_version: str, feature_version: str
    ) -> str | None:
        return "prodrun1"


@dataclass
class Store:
    saved: dict[str, Mapping[str, Any]] = field(default_factory=dict)
    rows: list[dict[str, Any]] = field(default_factory=list)

    def save_json(self, path: str, value: Mapping[str, Any]) -> str:
        json.dumps(value)  # must be JSON-safe
        self.saved[path] = value
        return f"gs://test-raw/{path}"

    def append_eval_run(self, row: Mapping[str, Any]) -> None:
        self.rows.append(dict(row))


@dataclass
class Experiments:
    runs: list[tuple[str, dict[str, Any], dict[str, Any]]] = field(default_factory=list)

    def log(self, run_name: str, params: Mapping[str, Any], metrics: Mapping[str, Any]) -> None:
        self.runs.append((run_name, dict(params), dict(metrics)))


def evaluator(source: Source, plots: Path) -> tuple[Evaluator, Store, Experiments]:
    store, experiments = Store(), Experiments()
    return Evaluator(source, store, experiments, CONFIG, 30, plots_dir=plots), store, experiments


def test_a_check_run_records_everything_and_draws_a_plot_per_video(tmp_path: Path) -> None:
    table, infos = channel(3)
    run, store, experiments = evaluator(Source(table, infos), tmp_path)
    outcome = run.run(CHANNEL)
    assert outcome.status == "check"

    (row,) = store.rows
    validate_eval_run(row)
    assert row["status"] == "check" and row["model_run_id"] == "prodrun1"
    assert row["channel_id"] == CHANNEL and row["model_version"] == "hazard-test"
    details = row["details"]
    json.dumps(details)
    assert details["mode"] == "check" and details["min_train_videos"] == 30
    assert (
        details["evaluation_uri"]
        == f"gs://test-raw/{CHANNEL}/evals/{outcome.run_id}/evaluation.json"
    )
    assert sorted(details["audiences"]) == ["all", "subscribed", "unsubscribed"]
    summary = details["audiences"]["all"]["summary"]
    assert {"model", "b0_channel", "b0_length", "b1", "b2"} <= set(summary)

    assert [name.split("-")[0] for name, _, _ in experiments.runs] == ["eval"] * 3
    _, params, metrics = experiments.runs[0]
    assert params["mode"] == "check" and "model_curve_mae_pp" in metrics

    assert sorted(p.name for p in outcome.plots) == sorted(f"{i.video_id}.png" for i in infos)
    assert all(p.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n" for p in outcome.plots)


def test_a_failure_is_recorded_as_a_failed_evaluation(tmp_path: Path) -> None:
    table, infos = channel(3)
    run, store, _ = evaluator(Source(table, infos[:1]), tmp_path)
    outcome = run.run(CHANNEL)
    assert outcome.status == "failed"
    assert outcome.error is not None and "at least 2 settled videos" in outcome.error
    assert (
        store.rows[0]["status"] == "failed" and store.rows[0]["details"]["error"] == outcome.error
    )

    run, store, _ = evaluator(Source(table, infos, context=False), tmp_path)
    assert run.run(CHANNEL).status == "failed"
    assert "No feature context" in store.rows[0]["details"]["error"]


def test_a_large_channel_gets_a_holdout_record_with_a_bootstrap(tmp_path: Path) -> None:
    table, infos = channel(45)
    run, store, _ = evaluator(Source(table, infos), tmp_path)
    outcome = run.run(CHANNEL, ["all"])
    assert outcome.status == "holdout"
    result = store.rows[0]["details"]["audiences"]["all"]
    assert result["bootstrap"]["beats_b0"] is True
    assert len(result["videos"]) == 9
    assert len(outcome.plots) == 9


def test_the_evaluate_command_reports_each_audience(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    table, infos = channel(3)
    run, _, _ = evaluator(Source(table, infos), tmp_path)
    monkeypatch.setattr(cli, "EVALUATOR", lambda: run)
    result = CliRunner().invoke(cli.app, ["evaluate", "--channel", CHANNEL, "--audience", "all"])
    assert result.exit_code == 0, result.output
    assert result.output.startswith(f"{CHANNEL}: check mode (3 settled videos")
    assert "  all: curve error model " in result.output and "B0 " in result.output
    assert "plots: 3 in" in result.output and "eval_runs: run " in result.output

    failing, _, _ = evaluator(Source(table, infos[:1]), tmp_path)
    monkeypatch.setattr(cli, "EVALUATOR", lambda: failing)
    failed = CliRunner().invoke(cli.app, ["evaluate", "--channel", CHANNEL])
    assert failed.exit_code == 1 and "evaluation failed" in failed.output

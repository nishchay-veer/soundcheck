from pathlib import Path

import pytest
from synthetic import channel
from test_evaluation_run import CHANNEL, Source, evaluator
from test_train import CHANNEL_A, make
from typer.testing import CliRunner

from soundcheck_modeling import cli
from soundcheck_modeling.progress import ProgressWriter


class Recorder(ProgressWriter):
    """Records every update and flush instead of writing to Firestore."""

    def __init__(self) -> None:
        self.updates: list[tuple[int, int]] = []
        self.flushed = 0

    def update(self, done: int, total: int) -> None:
        self.updates.append((done, total))

    def flush(self) -> None:
        self.flushed += 1


@pytest.fixture
def recorder(monkeypatch: pytest.MonkeyPatch) -> Recorder:
    monkeypatch.setenv("GCP_PROJECT_ID", "proj")
    progress = Recorder()
    monkeypatch.setattr(cli, "PROGRESS", lambda stage, channel: progress)
    return progress


def test_the_train_stage_fits_every_audience_and_reports_progress(
    recorder: Recorder, monkeypatch: pytest.MonkeyPatch
) -> None:
    trainer, store, _, _ = make(min_videos=3)
    monkeypatch.setattr(cli, "TRAINER", lambda: trainer)
    result = CliRunner().invoke(cli.app, ["stage", "train", "--channel", CHANNEL_A])
    assert result.exit_code == 0, result.output
    # 0 of 3 first, so the screen counts from the start.
    assert recorder.updates == [(0, 3), (1, 3), (2, 3), (3, 3)] and recorder.flushed == 1
    assert [row["audience"] for row in store.runs] == ["all", "subscribed", "unsubscribed"]


def test_the_channel_comes_from_the_job_environment(
    recorder: Recorder, monkeypatch: pytest.MonkeyPatch
) -> None:
    trainer, _, _, _ = make(min_videos=3)
    monkeypatch.setattr(cli, "TRAINER", lambda: trainer)
    monkeypatch.setenv("CHANNEL_ID", CHANNEL_A)
    assert CliRunner().invoke(cli.app, ["stage", "train"]).exit_code == 0
    monkeypatch.delenv("CHANNEL_ID")
    missing = CliRunner().invoke(cli.app, ["stage", "train"])
    assert missing.exit_code == 2 and "pass --channel or set CHANNEL_ID" in missing.output


def test_the_pooled_stage_needs_no_channel(
    recorder: Recorder, monkeypatch: pytest.MonkeyPatch
) -> None:
    trainer, store, _, _ = make(min_videos=3)
    monkeypatch.setattr(cli, "TRAINER", lambda: trainer)
    result = CliRunner().invoke(cli.app, ["stage", "train-pooled"])
    assert result.exit_code == 0, result.output
    assert {row["channel_id"] for row in store.runs} == {"pooled"}


def test_the_evaluate_stage_draws_no_plots(
    recorder: Recorder, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    table, infos = channel(3)
    run, store, _ = evaluator(Source(table, infos), tmp_path)
    monkeypatch.setattr(cli, "EVALUATOR", lambda: run)
    result = CliRunner().invoke(cli.app, ["stage", "evaluate", "--channel", CHANNEL])
    assert result.exit_code == 0, result.output
    assert "plots: none" in result.output
    assert list(tmp_path.iterdir()) == []
    assert recorder.updates == [(0, 3), (1, 3), (2, 3), (3, 3)]
    assert store.rows[0]["status"] == "check"


def test_an_unknown_stage_is_refused(recorder: Recorder) -> None:
    result = CliRunner().invoke(cli.app, ["stage", "publish"])
    assert result.exit_code == 2
    assert "expected one of train, train-pooled, evaluate" in result.output

from collections.abc import Mapping
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from typing import Any

import numpy as np
import pytest
from scipy.special import expit
from typer.testing import CliRunner

from soundcheck_modeling import cli, train
from soundcheck_modeling.contract import ModelConfig, validate_artifact, validate_model_run
from soundcheck_modeling.data import ChannelContext, TrainingTable, table_from_rows
from soundcheck_modeling.fit import fit_model
from soundcheck_modeling.train import Trainer

CHANNEL_A = "UCaaaaaaaaaaaaaaaaaaaaaa"
CHANNEL_B = "UCbbbbbbbbbbbbbbbbbbbbbb"
SPEC = {
    "features": [
        {"name": name, "kind": kind, "clip": None}
        for name, kind in [
            ("pos_b1", "spline"),
            ("energy", "delivery"),
            ("beat_sponsor", "beat_type"),
            ("never_varies", "beat_type"),
            ("mix_search", "mix"),
        ]
    ]
}
CONFIG = ModelConfig(
    model_version="hazard-v1",
    feature_version="feat-test",
    columns={
        "all": ["pos_b1", "energy", "beat_sponsor", "never_varies"],
        "subscribed": ["pos_b1", "energy", "beat_sponsor", "never_varies"],
        "unsubscribed": ["pos_b1", "energy", "beat_sponsor", "never_varies", "mix_search"],
    },
    unpenalized=["pos_b1"],
    lambdas=[0.1, 10.0],
    pooled_lambda=0.1,
    folds=5,
)
CONTEXT = ChannelContext(
    extraction_version="beats-v5",
    median_target_level=2.0,
    mix_mean={"search": 0.2, "suggested": 0.1, "browse": 0.5},
    video_ids=[],
)


def rows(
    channel: str,
    videos: int,
    seed: int,
    audiences: tuple[str, ...] = ("all", "subscribed", "unsubscribed"),
) -> list[dict[str, Any]]:
    """Curves whose hazards follow known coefficients, with binomial noise."""
    rng = np.random.default_rng(seed)
    result = []
    for v in range(videos):
        mix = rng.uniform(-0.2, 0.2)
        energy = rng.integers(1, 6, 100).astype(float)
        sponsor = (rng.random(100) < 0.15).astype(float)
        for audience in audiences:
            survival = 1.0
            for b in range(100):
                position = (b + 0.5) / 100
                at_risk = 3000.0 * survival
                hazard = float(expit(-3 + 0.8 * position - 0.2 * energy[b] + 0.5 * sponsor[b]))
                observed = rng.binomial(int(at_risk), hazard) / int(at_risk)
                result.append(
                    {
                        "channel_id": channel,
                        "video_id": f"{channel[-4:]}-v{v}",
                        "audience": audience,
                        "bin": b + 1,
                        "hazard": observed,
                        "n_at_risk": at_risk,
                        "video_views": 3000,
                        "x": [
                            position,
                            energy[b],
                            sponsor[b],
                            0.0,
                            mix if audience == "unsubscribed" else 0.0,
                        ],
                    }
                )
                survival *= 1 - observed
    return result


@dataclass
class FakeSource:
    tables: dict[str | None, TrainingTable]
    contexts: dict[str, ChannelContext]

    def training_table(self, feature_version: str, channel: str | None) -> TrainingTable:
        assert feature_version == CONFIG.feature_version
        return self.tables[channel]

    def channel_contexts(self, feature_version: str) -> dict[str, ChannelContext]:
        return self.contexts


@dataclass
class FakeStore:
    artifacts: dict[str, dict[str, Any]] = field(default_factory=dict)
    runs: list[dict[str, Any]] = field(default_factory=list)

    def save_artifact(self, path: str, artifact: Mapping[str, Any]) -> str:
        uri = f"gs://test-raw/{path}"
        self.artifacts[uri] = dict(artifact)
        return uri

    def load_artifact(self, uri: str) -> dict[str, Any]:
        return self.artifacts[uri]

    def append_model_run(self, row: Mapping[str, Any]) -> None:
        self.runs.append(dict(row))

    def latest_pooled_uri(
        self, audience: str, model_version: str, feature_version: str
    ) -> str | None:
        fitted = [
            r
            for r in self.runs
            if r["channel_id"] == "pooled" and r["audience"] == audience and r["status"] == "fitted"
        ]
        return fitted[-1]["artifact_uri"] if fitted else None


@dataclass
class FakeExperiments:
    runs: list[tuple[str, dict[str, Any], dict[str, Any]]] = field(default_factory=list)
    fail: bool = False

    def log(self, run_name: str, params: Mapping[str, Any], metrics: Mapping[str, Any]) -> None:
        if self.fail:
            raise PermissionError("aiplatform.metadataStores.get denied")
        self.runs.append((run_name, dict(params), dict(metrics)))


def make(min_videos: int = 30) -> tuple[Trainer, FakeStore, FakeExperiments, FakeSource]:
    """Two channels of 4 videos each; the pooled table holds both."""
    source = FakeSource(
        tables={
            CHANNEL_A: table_from_rows("feat-test", SPEC, rows(CHANNEL_A, 4, seed=1)),
            CHANNEL_B: table_from_rows("feat-test", SPEC, rows(CHANNEL_B, 4, seed=2)),
            None: table_from_rows("feat-test", SPEC, rows(CHANNEL_A, 4, 1) + rows(CHANNEL_B, 4, 2)),
        },
        contexts={CHANNEL_A: CONTEXT, CHANNEL_B: CONTEXT},
    )
    store = FakeStore()
    experiments = FakeExperiments()
    clock = iter(datetime(2026, 10, 11, 9, 0, s, tzinfo=UTC) for s in range(60))
    trainer = Trainer(source, store, experiments, CONFIG, min_videos, now=lambda: next(clock))
    return trainer, store, experiments, source


def test_a_channels_models_are_written_validated_and_logged_but_unusable_below_the_minimum() -> (
    None
):
    trainer, store, experiments, _ = make(min_videos=30)
    outcomes = trainer.train_channel(CHANNEL_A, ["all", "subscribed", "unsubscribed"])
    assert [o.status for o in outcomes] == ["fitted"] * 3
    assert [o.usable for o in outcomes] == [False] * 3
    assert outcomes[0].reasons == ["trained on 4 videos; at least 30 are needed"]

    artifact = store.artifacts[outcomes[2].artifact_uri or ""]
    validate_artifact(artifact)
    assert artifact["channelId"] == CHANNEL_A
    assert artifact["audience"] == "unsubscribed"
    assert artifact["featureNames"] == ["pos_b1", "energy", "beat_sponsor", "mix_search"]
    assert artifact["droppedFeatures"] == ["never_varies"]
    assert artifact["unpenalized"] == ["pos_b1"]
    assert artifact["channelContext"] == {
        "medianTargetLevel": 2.0,
        "mixMean": {"search": 0.2, "suggested": 0.1, "browse": 0.5},
    }
    assert artifact["extractionVersion"] == "beats-v5"
    assert artifact["priorRef"] is None
    assert artifact["trainVideoIds"] == [f"aaaa-v{v}" for v in range(4)]
    assert artifact["metrics"]["folds"] == 4
    assert [c["lambda"] for c in artifact["metrics"]["cv"]] == [0.1, 10.0]
    assert artifact["lambda"] in (0.1, 10.0)
    assert (
        outcomes[2].artifact_uri
        == f"gs://test-raw/{CHANNEL_A}/models/{artifact['runId']}/unsubscribed.json"
    )

    assert len(store.runs) == 3
    for row in store.runs:
        validate_model_run(row)
    assert store.runs[0]["details"]["usable"] is False
    assert [name for name, _, _ in experiments.runs] == [
        f"{CHANNEL_A.lower()}-{audience}-{artifact['runId'][:12]}"
        for audience in ("all", "subscribed", "unsubscribed")
    ]


def test_estimates_are_close_to_the_coefficients_that_made_the_data() -> None:
    trainer, store, _, _ = make(min_videos=3)
    (outcome,) = trainer.train_channel(CHANNEL_A, ["all"])
    assert outcome.usable and outcome.reasons == []
    artifact = store.artifacts[outcome.artifact_uri or ""]
    raw = {
        n: b / s
        for n, b, s in zip(artifact["featureNames"], artifact["beta"], artifact["sd"], strict=True)
    }
    assert raw["energy"] == pytest.approx(-0.2, abs=0.05)
    assert raw["beat_sponsor"] == pytest.approx(0.5, abs=0.1)


def test_a_pooled_model_from_one_channel_is_no_prior() -> None:
    trainer, store, _, source = make(min_videos=3)
    source.tables[None] = source.tables[CHANNEL_A]
    (pooled,) = trainer.train_pooled(["all"])
    assert pooled.status == "fitted" and not pooled.usable
    assert pooled.reasons == ["pooled from 1 channel; a prior needs at least 2"]
    pooled_artifact = store.artifacts[pooled.artifact_uri or ""]
    assert pooled_artifact["channelId"] is None and pooled_artifact["channelContext"] is None
    assert store.runs[0]["channel_id"] == "pooled"

    (own,) = trainer.train_channel(CHANNEL_A, ["all"])
    assert store.artifacts[own.artifact_uri or ""]["priorRef"] is None


def test_a_pooled_model_from_two_channels_becomes_each_channels_prior() -> None:
    trainer, store, _, _ = make(min_videos=3)
    (pooled,) = trainer.train_pooled(["all"])
    assert pooled.usable
    assert store.artifacts[pooled.artifact_uri or ""]["trainChannelIds"] == [CHANNEL_A, CHANNEL_B]
    (own,) = trainer.train_channel(CHANNEL_A, ["all"])
    artifact = store.artifacts[own.artifact_uri or ""]
    assert artifact["priorRef"] == pooled.artifact_uri
    assert store.runs[-1]["details"]["prior_ref"] == pooled.artifact_uri


def test_a_fit_that_does_not_converge_writes_no_model(monkeypatch: pytest.MonkeyPatch) -> None:
    def stalled(*args: Any, **kwargs: Any) -> Any:
        return fit_model(*args, **kwargs, max_iterations=1, newton_steps=0)

    monkeypatch.setattr(train, "fit_model", stalled)
    monkeypatch.setattr(train, "cross_validate", lambda *a, **k: train.CrossValidation([], 0, 1.0))
    trainer, store, _, _ = make()
    (outcome,) = trainer.train_channel(CHANNEL_A, ["all"])
    assert outcome.status == "not_converged" and outcome.artifact_uri is None
    assert store.artifacts == {}
    assert store.runs[0]["status"] == "not_converged" and store.runs[0]["artifact_uri"] is None
    assert store.runs[0]["details"]["converged"] is False


def test_an_audience_without_rows_and_a_broken_one_are_recorded_and_the_rest_still_fit() -> None:
    only_all = table_from_rows(
        "feat-test", SPEC, rows(CHANNEL_A, 4, 1, audiences=("all", "unsubscribed"))
    )
    trainer, store, _, source = make(min_videos=3)
    source.tables[CHANNEL_A] = only_all
    trainer.config = replace(CONFIG, columns={**CONFIG.columns, "unsubscribed": ["no_such_column"]})
    outcomes = trainer.train_channel(CHANNEL_A, ["all", "subscribed", "unsubscribed"])
    assert [o.status for o in outcomes] == ["fitted", "no_data", "failed"]
    assert outcomes[2].error == "Columns not in feat-test: no_such_column"
    assert [r["status"] for r in store.runs] == ["fitted", "no_data", "failed"]


def test_an_experiment_logging_failure_is_recorded_without_losing_the_model() -> None:
    trainer, store, experiments, _ = make(min_videos=3)
    experiments.fail = True
    (outcome,) = trainer.train_channel(CHANNEL_A, ["all"])
    assert outcome.status == "fitted"
    assert "metadataStores.get denied" in store.runs[0]["details"]["experiment_error"]


def test_a_channel_needs_its_feature_context() -> None:
    trainer, _, _, source = make()
    source.contexts = {}
    with pytest.raises(RuntimeError, match="No feature context"):
        trainer.train_channel(CHANNEL_A, ["all"])


def test_fit_commands_report_each_audience(monkeypatch: pytest.MonkeyPatch) -> None:
    trainer, _, _, _ = make(min_videos=30)
    monkeypatch.setattr(cli, "TRAINER", lambda: trainer)
    runner = CliRunner()
    result = runner.invoke(cli.app, ["fit", "--channel", CHANNEL_A, "--audience", "subscribed"])
    assert result.exit_code == 0, result.output
    assert result.output.startswith(
        f"{CHANNEL_A}, subscribed: fitted, not usable (trained on 4 videos"
    )
    assert "rows from 4 videos -> gs://test-raw/" in result.output
    pooled = runner.invoke(cli.app, ["fit-pooled", "--audience", "all"])
    assert pooled.output.startswith("pooled, all: fitted, usable, lambda 0.1")
    bad = runner.invoke(cli.app, ["fit", "--channel", CHANNEL_A, "--audience", "everyone"])
    assert bad.exit_code != 0 and "unknown audience everyone" in bad.output

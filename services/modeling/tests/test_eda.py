import json
from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from typer.testing import CliRunner

from soundcheck_modeling import data, eda
from soundcheck_modeling.cli import app
from soundcheck_modeling.settings import Settings

SPEC = {
    "features": [
        {"name": "beat_hook", "kind": "beat_type", "clip": [0, 1]},
        {"name": "energy", "kind": "delivery", "clip": [1, 5]},
        {"name": "beat_tangent", "kind": "beat_type", "clip": [0, 1]},
        {"name": "pos_b1", "kind": "spline", "clip": [0, 1]},
    ]
}


def make_rows(
    videos: tuple[str, ...] = ("vidA", "vidB"),
    skip: tuple[tuple[str, str], ...] = (),
) -> list[dict[str, Any]]:
    """Hazard rises with the hook share and falls with energy; the tangent share is always 0."""
    rows = []
    for v, video in enumerate(videos):
        for audience in eda.AUDIENCES:
            if (video, audience) in skip:
                continue
            for b in range(1, 101):
                hook = ((b * 7 + v * 3) % 10) / 10
                energy = 1 + ((b * 3 + v) % 5)
                rows.append(
                    {
                        "channel_id": "UCchannel",
                        "video_id": video,
                        "audience": audience,
                        "bin": b,
                        "hazard": 0.01 + 0.05 * hook - 0.004 * energy + 0.0001 * b,
                        "n_at_risk": 100.0 * (1 - b / 200),
                        "video_views": 100,
                        "x": [hook, float(energy), 0.0, b / 100],
                    }
                )
    return rows


def test_average_ranks_share_tied_ranks() -> None:
    ranks = eda.average_ranks(np.array([10.0, 20.0, 20.0, 30.0, 20.0]))
    assert ranks.tolist() == [1.0, 3.0, 3.0, 5.0, 3.0]


def test_spearman_matches_wikipedias_iq_and_tv_example() -> None:
    iq = np.array([106, 100, 86, 101, 99, 103, 97, 113, 112, 110], dtype=np.float64)
    tv = np.array([7, 27, 2, 50, 28, 29, 20, 12, 6, 17], dtype=np.float64)
    assert eda.spearman(iq, tv) == pytest.approx(-29 / 165, abs=1e-12)
    assert eda.spearman(iq, np.ones(10)) is None


def test_weighted_pearson_reduces_to_pearson_and_ignores_zero_weights() -> None:
    rng = np.random.default_rng(7)
    x = rng.normal(size=50)
    y = 0.5 * x + rng.normal(size=50)
    assert eda.weighted_pearson(x, y, np.ones(50)) == pytest.approx(np.corrcoef(x, y)[0, 1])
    weights = np.r_[np.ones(30), np.zeros(20)]
    assert eda.weighted_pearson(x, y, weights) == pytest.approx(np.corrcoef(x[:30], y[:30])[0, 1])
    assert eda.weighted_pearson(x, y, np.zeros(50)) is None
    assert eda.weighted_pearson(np.ones(50), y, np.ones(50)) is None


def test_table_from_rows_checks_every_vector_against_the_spec() -> None:
    table = data.table_from_rows("feat-test", SPEC, make_rows())
    assert table.rows == 600
    assert table.x.shape == (600, 4)
    assert table.names == ["beat_hook", "energy", "beat_tangent", "pos_b1"]
    bad = make_rows()[:1]
    bad[0]["x"] = [1.0]
    with pytest.raises(ValueError, match="x has 1 values, the spec 4"):
        data.table_from_rows("feat-test", SPEC, bad)


def test_summarize_counts_rows_and_ranks_the_strongest_features() -> None:
    table = data.table_from_rows("feat-test", SPEC, make_rows(skip=(("vidB", "subscribed"),)))
    summary = eda.summarize(table)
    assert summary.groups == [
        ("UCchannel", "all", 2, 200),
        ("UCchannel", "subscribed", 1, 100),
        ("UCchannel", "unsubscribed", 2, 200),
    ]
    assert summary.videos_per_channel == {"UCchannel": 2}
    assert summary.incomplete_videos == [("UCchannel", "vidB", ["all", "unsubscribed"])]
    assert summary.non_finite == 0
    assert summary.constant == ["beat_tangent"]

    ranked = summary.correlations["all"]
    assert ranked[0].name == "beat_hook"
    assert ranked[0].spearman is not None and ranked[0].spearman > 0.8
    energy = next(c for c in ranked if c.name == "energy")
    assert energy.spearman is not None and energy.spearman < 0
    assert ranked[-1].name == "beat_tangent" and ranked[-1].spearman is None
    assert [c.name for c in eda.top_correlations(summary, "all", content=False, count=5)] == [
        "pos_b1"
    ]

    hazard = summary.mean_hazard["all"]
    assert hazard.shape == (100,)
    first = [r for r in make_rows() if r["audience"] == "all" and r["bin"] == 1]
    assert hazard[0] == pytest.approx(np.mean([r["hazard"] for r in first]))


def test_write_report_writes_the_markdown_and_three_plots(tmp_path: Path) -> None:
    table = data.table_from_rows("feat-test", SPEC, make_rows())
    folder, _ = eda.write_report(table, tmp_path, datetime(2026, 10, 10, 12, 0, tzinfo=UTC))
    assert folder == tmp_path / "feat-test"
    text = (folder / "README.md").read_text()
    assert "Feature version `feat-test` · 600 rows · 1 channel(s)" in text
    assert "Too few videos to read much into" in text
    assert "| UCchannel | all | 2 | 200 |" in text
    assert "### all: content features" in text
    assert "`beat_tangent`" in text
    for name in ("hazard-by-bin.png", "correlations.png", "distributions.png"):
        assert (folder / name).read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"


@dataclass
class FakeJob:
    rows: list[Mapping[str, Any]]

    def result(self) -> list[Mapping[str, Any]]:
        return self.rows


@dataclass
class FakeClient:
    """Answers the spec query, then the rows query; records each query's parameters."""

    spec: Any
    rows: list[dict[str, Any]]
    calls: list[tuple[str, dict[str, Any]]] = field(default_factory=list)

    def query(self, sql: str, job_config: Any, location: str) -> FakeJob:
        params = {p.name: p.value for p in job_config.query_parameters}
        self.calls.append((sql, params))
        if "feature_specs" in sql:
            return FakeJob([{"feature_version": "feat-test", "spec": self.spec}])
        return FakeJob(self.rows)


def test_read_training_table_takes_the_newest_spec_and_its_rows() -> None:
    settings = Settings(project="proj", dataset="ds", location="US")
    # The client may return a JSON column as text; the reader parses it.
    client = FakeClient(spec=json.dumps(SPEC), rows=make_rows())
    table = data.read_training_table(client, settings, None, "UCchannel")  # type: ignore[arg-type]
    assert table.feature_version == "feat-test"
    assert table.rows == 600
    (spec_sql, spec_params), (rows_sql, rows_params) = client.calls
    assert "`proj.ds.feature_specs`" in spec_sql and spec_params == {"version": None}
    assert "`proj.ds.training_bins`" in rows_sql
    assert rows_params == {"version": "feat-test", "channel": "UCchannel"}


def test_eda_command_writes_the_report_and_prints_the_top_features(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("GCP_PROJECT_ID", "proj")
    seen: list[tuple[str | None, str | None]] = []

    def reader(settings: Settings, version: str | None, channel: str | None) -> data.TrainingTable:
        seen.append((version, channel))
        return data.table_from_rows("feat-test", SPEC, make_rows())

    monkeypatch.setattr(eda, "READER", reader)
    result = CliRunner().invoke(app, ["eda", "--channel", "UCchannel", "--out", str(tmp_path)])
    assert result.exit_code == 0, result.output
    assert seen == [(None, "UCchannel")]
    assert f"600 rows of feat-test: report in {tmp_path / 'feat-test'}" in result.output
    assert "  all: beat_hook +" in result.output
    assert (tmp_path / "feat-test" / "README.md").exists()

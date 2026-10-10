from datetime import date, timedelta
from typing import Any

import numpy as np
import pytest
from scipy.special import expit

from soundcheck_modeling.contract import ModelConfig
from soundcheck_modeling.data import TrainingTable, VideoInfo, table_from_rows
from soundcheck_modeling.evaluate import (
    choose_split,
    curve_mae,
    drop_hit_rate,
    evaluate_channel,
    fit_inflation,
    paired_bootstrap,
    peaks,
    pooled_prior,
    retention_error,
    sampled_curves,
    survival,
)
from soundcheck_modeling.fit import fit_model

AS_OF = date(2026, 10, 10)
FEATURES = [
    ("is_first_bin", "position"),
    ("log_bin_seconds", "position"),
    ("pos_b1", "spline"),
    ("pos_b2", "spline"),
    ("energy", "delivery"),
    ("beat_sponsor", "beat_type"),
]
SPEC = {"features": [{"name": n, "kind": k, "clip": None} for n, k in FEATURES]}
COLUMNS = [name for name, _ in FEATURES]
CONFIG = ModelConfig(
    model_version="hazard-test",
    feature_version="feat-test",
    columns={"all": COLUMNS, "subscribed": COLUMNS, "unsubscribed": COLUMNS},
    unpenalized=["pos_b1", "pos_b2"],
    lambdas=[0.1, 1.0, 10.0],
    pooled_lambda=0.1,
    folds=5,
)


def channel(videos: int, seed: int = 1, name: str = "UCaaaaaaaaaaaaaaaaaaaaaa"):
    """
    Videos whose drop-off depends on energy and sponsor time as well as
    position, so a model that reads content should beat the channel average.
    """
    rng = np.random.default_rng(seed)
    rows: list[dict[str, Any]] = []
    infos = []
    for v in range(videos):
        video = f"{name[-3:]}-v{v:02d}"
        duration = float(rng.uniform(120, 900))
        infos.append(VideoInfo(video, AS_OF - timedelta(days=400 - 7 * v), duration))
        energy = np.clip(rng.normal(rng.uniform(1.5, 4.5), 0.3, 100), 1, 5)
        start = rng.integers(10, 80)
        sponsor = np.zeros(100)
        if rng.random() < 0.5:
            sponsor[start : start + 8] = 1.0
        for audience in ("all", "subscribed", "unsubscribed"):
            survived = 1.0
            for b in range(100):
                position = (b + 0.5) / 100
                features = [
                    float(b == 0),
                    float(np.log(duration / 100)),
                    position,
                    position**2,
                    float(energy[b]),
                    float(sponsor[b]),
                ]
                truth = expit(
                    -3.8
                    + 1.5 * features[0]
                    + 0.6 * position
                    - 0.5 * position**2
                    - 0.35 * (energy[b] - 3)
                    + 1.2 * sponsor[b]
                )
                at_risk = max(int(4000 * survived), 1)
                hazard = rng.binomial(at_risk, truth) / at_risk
                rows.append(
                    {
                        "channel_id": name,
                        "video_id": video,
                        "audience": audience,
                        "bin": b + 1,
                        "hazard": hazard,
                        "n_at_risk": float(at_risk),
                        "video_views": 4000,
                        "x": features,
                    }
                )
                survived *= 1 - hazard
    return table_from_rows("feat-test", SPEC, rows), infos


def test_the_newest_fifth_is_the_test_set_and_young_videos_wait() -> None:
    infos = [VideoInfo(f"v{i:02d}", AS_OF - timedelta(days=500 - 10 * i), 300.0) for i in range(50)]
    split = choose_split(infos, AS_OF, min_train=30)
    assert split.mode == "holdout" and split.reason is None
    (fold,) = split.folds
    # v49 is 10 days old: too new. Of the 49 settled, the newest 10 (ceil of 20%) are the test set.
    assert split.too_new == ["v49"]
    assert fold.test == [f"v{i:02d}" for i in range(39, 49)]
    assert fold.train == [f"v{i:02d}" for i in range(39)]


def test_a_small_channel_runs_a_check_holding_out_each_video_in_turn() -> None:
    infos = [VideoInfo(f"v{i}", AS_OF - timedelta(days=100 + i), 300.0) for i in range(3)]
    split = choose_split(infos, AS_OF, min_train=30)
    assert split.mode == "check"
    assert split.reason == (
        "3 settled videos: a held-out test needs 6 test videos and 30 training videos"
    )
    assert sorted(t for fold in split.folds for t in fold.test) == ["v0", "v1", "v2"]
    assert all(set(fold.train).isdisjoint(fold.test) for fold in split.folds)
    with pytest.raises(ValueError, match="at least 2 settled videos"):
        choose_split(infos[:1], AS_OF, min_train=30)


def test_scores_compare_curves_from_bin_2_and_find_drop_offs_apart() -> None:
    actual = np.linspace(1.0, 0.2, 100)
    assert curve_mae(actual + 0.05, actual) == pytest.approx(5.0)
    assert curve_mae(np.concatenate(([0.0], actual[1:])), actual) == 0.0  # bin 1 is not scored
    assert retention_error(actual - 0.1, actual) == pytest.approx(10.0)
    hazard = np.full(100, 0.01)
    hazard[[0, 20, 21, 50, 80]] = [0.9, 0.5, 0.4, 0.3, 0.2]
    # Bin 1 is left out, and bin 22 is too close to bin 21.
    assert peaks(hazard) == [20, 50, 80]
    curve = survival(hazard)
    assert drop_hit_rate(curve, curve) == 1.0
    moved = hazard.copy()
    moved[[20, 21, 50, 80]] = 0.01
    moved[[5, 35, 65]] = 0.5
    assert drop_hit_rate(survival(moved), curve) == 0.0


def test_the_bootstrap_says_beats_only_when_the_whole_interval_is_below_zero() -> None:
    rng = np.random.default_rng(0)
    clear = paired_bootstrap(list(-1.0 + 0.2 * rng.standard_normal(12)), rng)
    assert clear is not None and clear["beats_b0"] is True and clear["high"] < 0
    unclear = paired_bootstrap(list(rng.standard_normal(12)), rng)
    assert unclear is not None and unclear["beats_b0"] is False
    assert paired_bootstrap([-1.0], rng) is None


def test_the_inflation_factor_restores_80_percent_coverage() -> None:
    """Measured curves drawn with 9 times the covariance need a factor of about 9."""
    table, _ = channel(12)
    rows = [i for i, a in enumerate(table.audience) if a == "all"]
    fit = fit_model(table.x[rows], COLUMNS, table.hazard[rows], table.n_at_risk[rows], 1.0)
    rng = np.random.default_rng(3)
    cases = []
    for v in range(60):
        x = table.x[rows][(v % 12) * 100 : (v % 12 + 1) * 100]
        actual = sampled_curves(fit, x, rng.standard_normal((1, len(fit.beta) + 1)), 9.0)[0]
        cases.append((fit, x, rng.standard_normal((200, len(fit.beta) + 1)), actual))
    assert fit_inflation(cases) == pytest.approx(9.0, rel=0.5)


def test_pooled_prior_needs_two_channels_and_leaves_the_test_videos_out() -> None:
    a, _ = channel(6, seed=1, name="UCaaaaaaaaaaaaaaaaaaaaaa")
    b, _ = channel(6, seed=2, name="UCbbbbbbbbbbbbbbbbbbbbbb")
    assert pooled_prior(a, "all", COLUMNS, set(), CONFIG) is None
    both = TrainingTable(
        feature_version="feat-test",
        names=a.names,
        kinds=a.kinds,
        channel=a.channel + b.channel,
        video=a.video + b.video,
        audience=a.audience + b.audience,
        bin=np.concatenate([a.bin, b.bin]),
        hazard=np.concatenate([a.hazard, b.hazard]),
        n_at_risk=np.concatenate([a.n_at_risk, b.n_at_risk]),
        video_views=np.concatenate([a.video_views, b.video_views]),
        x=np.vstack([a.x, b.x]),
    )
    prior = pooled_prior(both, "all", COLUMNS, {"aaa-v05"}, CONFIG)
    assert prior is not None and set(prior) == set(COLUMNS)
    assert prior["energy"] == pytest.approx(-0.35, abs=0.1)
    # Leaving out channel B's videos leaves one channel: no prior.
    assert pooled_prior(both, "all", COLUMNS, {f"bbb-v{i:02d}" for i in range(6)}, CONFIG) is None


def test_a_content_aware_model_beats_the_baselines_on_held_out_videos() -> None:
    table, infos = channel(45)
    llm = {infos[-1].video_id: np.linspace(1.0, 0.3, 100)}
    result = evaluate_channel(
        channel_id="UCaaaaaaaaaaaaaaaaaaaaaa",
        table=table,
        videos=infos,
        as_of=AS_OF,
        config=CONFIG,
        min_train_videos=30,
        llm_curves=llm,
        view_percentages={(infos[-1].video_id, "subscribed"): 51.5},
        audiences=["all"],
    )
    assert result.mode == "holdout" and len(result.folds) == 1
    fold = result.folds[0]
    assert len(fold.test) == 9 and set(fold.train).isdisjoint(fold.test)

    audience = result.audiences["all"]
    model = audience.summary["model"]
    assert len(audience.videos) == 9 and audience.not_converged == []
    assert model["curve_mae_pp"] < audience.summary["b0_channel"]["curve_mae_pp"]
    assert model["curve_mae_pp"] < audience.summary["b0_length"]["curve_mae_pp"]
    assert model["curve_mae_pp"] < audience.summary["b2"]["curve_mae_pp"]
    assert model["ranking_spearman"] is not None and model["ranking_spearman"] > 0.6
    assert audience.summary["b0_channel"]["ranking_spearman"] is None  # one curve for all
    assert audience.summary["b1"]["videos"] == 1.0
    assert audience.bootstrap is not None and audience.bootstrap["beats_b0"] is True
    assert audience.coverage is not None and 0.0 <= audience.coverage <= 1.0
    assert audience.inflation is not None and audience.inflation["factor"] >= 1.0
    newest = audience.videos[-1]
    assert newest.youtube_avp is None  # all viewers have no YouTube figure
    assert set(newest.curves) >= {"actual", "low", "median", "high", "model", "b2", "b1"}


def test_check_mode_scores_every_video_once_and_says_so() -> None:
    table, infos = channel(3)
    result = evaluate_channel(
        channel_id="UCaaaaaaaaaaaaaaaaaaaaaa",
        table=table,
        videos=infos,
        as_of=AS_OF,
        config=CONFIG,
        min_train_videos=30,
    )
    assert result.mode == "check"
    assert result.reason is not None and "3 settled videos" in result.reason
    assert len(result.folds) == 3
    for audience in result.audiences.values():
        assert sorted(v.video_id for v in audience.videos) == sorted(i.video_id for i in infos)
        assert audience.inflation is None  # never in check mode
        assert audience.summary["model"]["videos"] == 3.0

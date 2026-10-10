"""A synthetic channel for the evaluation tests: drop-off depends on energy
and sponsor time as well as position, so a model that reads content should
beat the channel average."""

from datetime import date, timedelta
from typing import Any

import numpy as np
from scipy.special import expit

from soundcheck_modeling.contract import ModelConfig
from soundcheck_modeling.data import VideoInfo, table_from_rows

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

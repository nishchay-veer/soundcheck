"""Evaluation plots (Phase 09): one PNG per test video, a panel per audience,
with the measured curve, the model's 80% band and median, and the baselines.
These are the demo slides.
"""

from pathlib import Path

import numpy as np
from matplotlib.figure import Figure

from soundcheck_modeling.evaluate import Evaluation

LABELS = {"all": "All viewers", "subscribed": "Subscribers", "unsubscribed": "Newcomers"}


def plot_video(evaluation: Evaluation, video_id: str, folder: Path) -> Path:
    """Writes `{folder}/{video_id}.png` and returns its path."""
    panels = [
        (audience, next(v for v in result.videos if v.video_id == video_id))
        for audience, result in evaluation.audiences.items()
        if any(v.video_id == video_id for v in result.videos)
    ]
    figure = Figure(figsize=(4.2 * max(len(panels), 1), 3.6))
    axes = np.atleast_1d(figure.subplots(1, max(len(panels), 1)))
    elapsed = np.arange(1, 101)
    for axis, (audience, video) in zip(axes, panels, strict=False):
        curves = video.curves
        axis.fill_between(
            elapsed, curves["low"], curves["high"], alpha=0.25, label="Model, 80% band"
        )
        axis.plot(elapsed, curves["median"], label="Model, median")
        axis.plot(elapsed, curves["actual"], color="black", linewidth=1.6, label="Measured")
        b0 = curves[
            "b0_channel"
            if evaluation.audiences[audience].b0_variant == "channel average"
            else "b0_length"
        ]
        axis.plot(elapsed, b0, color="grey", linestyle="--", label="Channel average (B0)")
        if "b1" in curves:
            axis.plot(
                elapsed, curves["b1"], color="tab:orange", linestyle=":", label="Generic LLM (B1)"
            )
        axis.set_ylim(0, 1.02)
        axis.set_xlabel("% of the video")
        axis.set_ylabel("Share still watching")
        axis.set_title(
            f"{LABELS.get(audience, audience)}: off by {video.scores['model'].curve_mae_pp:.1f} pp",
            fontsize=9,
        )
        axis.legend(fontsize=6, loc="upper right")
    mode = "pipeline check, not a result" if evaluation.mode == "check" else "held out"
    duration = panels[0][1].duration_s if panels else 0
    figure.suptitle(f"{video_id} ({duration:.0f} s), {mode}", fontsize=10)
    figure.tight_layout()
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{video_id}.png"
    figure.savefig(path, dpi=110)
    return path

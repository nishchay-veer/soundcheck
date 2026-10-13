"""The model card (Phase 09): `docs/model-card.md`, rendered from the latest
evaluation of each channel with a Jinja2 template.
"""

from collections.abc import Mapping, Sequence
from datetime import datetime
from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader, StrictUndefined

from soundcheck_modeling.settings import REPO_ROOT

TEMPLATES = Path(__file__).resolve().parent / "templates"
DEFAULT_CARD = REPO_ROOT / "docs" / "model-card.md"
LABELS = {"all": "All viewers", "subscribed": "Subscribers", "unsubscribed": "Newcomers"}
DEFAULT_MIN_TRAIN = 20


def _pp(value: float | None) -> str:
    return "n/a" if value is None else f"{value:.1f}"


def _signed(value: float | None) -> str:
    return "n/a" if value is None else f"{value:+.1f}"


def _share(value: float | None) -> str:
    return "n/a" if value is None else f"{100 * value:.0f}%"


def _ranking(value: float | None) -> str:
    return "n/a" if value is None else f"{value:.2f}"


def _audience_row(name: str, result: Mapping[str, Any], mode: str) -> dict[str, Any]:
    summary = result["summary"]
    b0_key = "b0_channel" if result["b0_variant"] == "channel average" else "b0_length"

    def metric(contender: str, key: str) -> float | None:
        entry = summary.get(contender)
        return None if entry is None else entry.get(key)

    bootstrap = result.get("bootstrap")
    inflation = result.get("inflation")
    if bootstrap is None:
        versus = "n/a (fewer than 2 test videos)"
    else:
        versus = (
            f"{_signed(bootstrap['mean_difference_pp'])} "
            f"({_signed(bootstrap['low'])} to {_signed(bootstrap['high'])})"
        )
    if mode != "holdout":
        verdict = "no claim (check mode)"
    elif bootstrap is not None and bootstrap["beats_b0"]:
        verdict = "beats the channel average"
    else:
        verdict = "does not beat the channel average"
    b1_videos = metric("b1", "videos")
    return {
        "audience": LABELS.get(name, name),
        "videos": len(result["videos"]),
        "model": _pp(metric("model", "curve_mae_pp")),
        "b0": _pp(metric(b0_key, "curve_mae_pp")),
        "b0_variant": result["b0_variant"],
        "b1": _pp(metric("b1", "curve_mae_pp")) if b1_videos else "n/a",
        "b2": _pp(metric("b2", "curve_mae_pp")),
        "versus": versus,
        "verdict": verdict,
        "retention": {c: _pp(metric(k, "retention_error_pp")) for c, k in _contenders(b0_key)},
        "drops": {c: _share(metric(k, "drop_hit_rate")) for c, k in _contenders(b0_key)},
        "ranking": {c: _ranking(metric(k, "ranking_spearman")) for c, k in _contenders(b0_key)},
        "coverage": _share(result.get("coverage")),
        "inflation": (
            "not checked (check mode)"
            if inflation is None
            else (
                f"none needed (validation coverage {_share(inflation['validation_coverage'])})"
                if inflation["factor"] == 1.0
                else f"x{inflation['factor']:.1f}, fitted on validation videos "
                f"(coverage {_share(inflation['validation_coverage'])} -> "
                f"{_share(inflation.get('test_coverage'))} on the test videos)"
            )
        ),
        "not_converged": result["not_converged"],
    }


def _contenders(b0_key: str) -> list[tuple[str, str]]:
    return [("model", "model"), ("b0", b0_key), ("b1", "b1"), ("b2", "b2")]


def card_context(
    evaluations: Sequence[Mapping[str, Any]],
    *,
    model_version: str,
    feature_version: str,
    generated: datetime,
) -> dict[str, Any]:
    """
    Plain values for the template, one entry per channel's latest evaluation.
    The minimum training videos is the one the evaluations used.
    """
    minimums = sorted({int(e.get("min_train_videos", DEFAULT_MIN_TRAIN)) for e in evaluations})
    channels = []
    for evaluation in sorted(evaluations, key=lambda e: str(e["channel_id"])):
        folds = evaluation["folds"]
        tested = sorted({v for fold in folds for v in fold["test"]})
        train_sizes = sorted({len(fold["train"]) for fold in folds})
        channels.append(
            {
                "channel_id": evaluation["channel_id"],
                "mode": evaluation["mode"],
                "reason": evaluation.get("reason"),
                "as_of": evaluation["as_of"],
                "tested": len(tested),
                "training": " or ".join(str(n) for n in train_sizes),
                "folds": len(folds),
                "too_new": len(evaluation.get("too_new", [])),
                "audiences": [
                    _audience_row(name, result, evaluation["mode"])
                    for name, result in evaluation["audiences"].items()
                    if result["summary"]
                ],
            }
        )
    return {
        "model_version": model_version,
        "feature_version": feature_version,
        "generated": generated.strftime("%Y-%m-%d"),
        "min_train_videos": " or ".join(str(m) for m in minimums) or str(DEFAULT_MIN_TRAIN),
        "channels": channels,
        "any_holdout": any(c["mode"] == "holdout" for c in channels),
    }


def render_card(context: Mapping[str, Any]) -> str:
    environment = Environment(
        loader=FileSystemLoader(TEMPLATES),
        autoescape=False,  # Markdown, not HTML
        undefined=StrictUndefined,
        keep_trailing_newline=True,
        trim_blocks=True,
        lstrip_blocks=True,
    )
    return environment.get_template("model-card.md.j2").render(**context)

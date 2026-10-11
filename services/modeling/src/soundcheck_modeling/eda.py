"""Exploratory analysis of the training table (Phase 07).

Reads `training_bins` and `feature_specs` and writes a Markdown report with
three plots: rows per channel and audience, missing data, each feature's
distribution, and each feature's correlation with the hazard. It summarizes
features; it never computes one.
"""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
from google.cloud import bigquery
from matplotlib.figure import Figure

from soundcheck_modeling.data import AUDIENCES, Floats, TrainingTable, read_training_table
from soundcheck_modeling.settings import REPO_ROOT, Settings

# Families that describe what is on screen and said, as opposed to where in the
# video a bin is (position, spline), the video as a whole, or who arrived (mix
# and its interactions).
CONTENT_KINDS = frozenset({"beat_type", "picture", "audio", "delivery", "dynamics", "narrative"})
# The data gate: below this many videos per channel, correlations mostly
# reflect which video a bin belongs to.
DATA_GATE_VIDEOS = 40
DEFAULT_OUT = REPO_ROOT / "docs" / "eda"


def average_ranks(values: Floats) -> Floats:
    """Ranks from 1, ties sharing the average of their ranks."""
    _, inverse, counts = np.unique(values, return_inverse=True, return_counts=True)
    ends = np.cumsum(counts)
    starts = ends - counts
    return ((starts + ends + 1) / 2.0)[inverse].astype(np.float64)


def weighted_pearson(x: Floats, y: Floats, weights: Floats) -> float | None:
    """Pearson correlation with weights; None when a side is constant or nothing has weight."""
    if weights.sum() <= 0:
        return None
    mx = np.average(x, weights=weights)
    my = np.average(y, weights=weights)
    vx = np.average((x - mx) ** 2, weights=weights)
    vy = np.average((y - my) ** 2, weights=weights)
    if vx <= 0 or vy <= 0:
        return None
    return float(np.average((x - mx) * (y - my), weights=weights) / np.sqrt(vx * vy))


def spearman(x: Floats, y: Floats) -> float | None:
    """Spearman's rank correlation; None when a side is constant."""
    return weighted_pearson(average_ranks(x), average_ranks(y), np.ones(len(x)))


@dataclass(frozen=True)
class FeatureStats:
    name: str
    kind: str
    mean: float
    sd: float
    low: float
    high: float
    nonzero: float  # share of rows


@dataclass(frozen=True)
class Correlation:
    name: str
    kind: str
    spearman: float | None
    weighted_pearson: float | None


@dataclass(frozen=True)
class Summary:
    feature_version: str
    rows: int
    groups: list[tuple[str, str, int, int]]  # channel, audience, videos, rows
    videos_per_channel: dict[str, int]
    non_finite: int
    incomplete_videos: list[tuple[str, str, list[str]]]  # channel, video, audiences it has
    constant: list[str]
    stats: list[FeatureStats]  # over the `all` rows, or every row without them
    correlations: dict[str, list[Correlation]]  # by audience, strongest first
    mean_hazard: dict[str, Floats]  # by audience: viewer-weighted mean hazard per bin


def _strength(correlation: Correlation) -> float:
    return abs(correlation.spearman) if correlation.spearman is not None else -1.0


def summarize(table: TrainingTable) -> Summary:
    channels = np.array(table.channel)
    videos = np.array(table.video)
    audiences = np.array(table.audience)
    groups: list[tuple[str, str, int, int]] = []
    for channel in sorted(set(table.channel)):
        for audience in AUDIENCES:
            in_group = (channels == channel) & (audiences == audience)
            if np.any(in_group):
                groups.append((channel, audience, len(set(videos[in_group])), int(in_group.sum())))
    videos_per_channel = {
        channel: len(set(videos[channels == channel])) for channel in sorted(set(table.channel))
    }

    audiences_of: dict[tuple[str, str], set[str]] = {}
    for channel, video, audience in zip(table.channel, table.video, table.audience, strict=True):
        audiences_of.setdefault((channel, video), set()).add(audience)
    incomplete = [
        (channel, video, sorted(present))
        for (channel, video), present in sorted(audiences_of.items())
        if len(present) < len(AUDIENCES)
    ]

    base = table.x[audiences == "all"] if np.any(audiences == "all") else table.x
    stats = [
        FeatureStats(
            name=name,
            kind=kind,
            mean=float(column.mean()),
            sd=float(column.std()),
            low=float(column.min()),
            high=float(column.max()),
            nonzero=float(np.mean(column != 0)),
        )
        for name, kind, column in zip(table.names, table.kinds, base.T, strict=True)
    ]
    constant = [
        name
        for name, column in zip(table.names, table.x.T, strict=True)
        if np.all(column == column[0])
    ]

    correlations: dict[str, list[Correlation]] = {}
    mean_hazard: dict[str, Floats] = {}
    for name in AUDIENCES:
        mask = audiences == name
        if not np.any(mask):
            continue
        hazard = table.hazard[mask]
        weights = table.n_at_risk[mask]
        correlations[name] = sorted(
            (
                Correlation(
                    name=feature,
                    kind=kind,
                    spearman=spearman(column, hazard),
                    weighted_pearson=weighted_pearson(column, hazard, weights),
                )
                for feature, kind, column in zip(
                    table.names, table.kinds, table.x[mask].T, strict=True
                )
            ),
            key=_strength,
            reverse=True,
        )
        bins = table.bin[mask]
        mean_hazard[name] = np.array(
            [
                np.average(hazard[bins == b], weights=weights[bins == b])
                if weights[bins == b].sum() > 0
                else float(hazard[bins == b].mean())
                for b in range(1, 101)
            ],
            dtype=np.float64,
        )

    return Summary(
        feature_version=table.feature_version,
        rows=table.rows,
        groups=groups,
        videos_per_channel=videos_per_channel,
        non_finite=int(np.sum(~np.isfinite(table.x))),
        incomplete_videos=incomplete,
        constant=constant,
        stats=stats,
        correlations=correlations,
        mean_hazard=mean_hazard,
    )


def _number(value: float | None, digits: int = 2) -> str:
    return "n/a" if value is None else f"{value:.{digits}f}"


def top_correlations(
    summary: Summary, audience: str, *, content: bool, count: int
) -> list[Correlation]:
    """The strongest defined correlations, among content features or among the rest."""
    return [
        c
        for c in summary.correlations.get(audience, [])
        if c.spearman is not None and (c.kind in CONTENT_KINDS) == content
    ][:count]


def render_markdown(summary: Summary, generated: datetime) -> str:
    fewest = min(summary.videos_per_channel.values(), default=0)
    lines = [
        "# Training table: exploratory analysis",
        "",
        f"Feature version `{summary.feature_version}` · {summary.rows} rows · "
        f"{len(summary.videos_per_channel)} channel(s) · generated "
        f"{generated.strftime('%Y-%m-%d %H:%M')} UTC by `soundcheck-modeling eda`",
        "",
    ]
    if fewest < DATA_GATE_VIDEOS:
        lines += [
            f"> **Too few videos to read much into.** The smallest channel has {fewest} "
            f"videos; the data gate asks for {DATA_GATE_VIDEOS}. With this few, a correlation "
            "mostly says which video a bin belongs to, and video-level features (format, "
            "target level) cannot be told apart from the video itself.",
            "",
        ]
    lines += ["## Rows", "", "| Channel | Audience | Videos | Rows |", "| --- | --- | --- | --- |"]
    lines += [f"| {c} | {a} | {v} | {r} |" for c, a, v, r in summary.groups]
    lines += [
        "",
        "## Missing data",
        "",
        f"- Non-finite feature values: {summary.non_finite}.",
        "- Videos without a curve for every audience: "
        + (
            "none."
            if not summary.incomplete_videos
            else "; ".join(f"{v} (has {', '.join(a)})" for _, v, a in summary.incomplete_videos)
            + "."
        ),
        f"- Features that never vary in this data ({len(summary.constant)} of "
        f"{len(summary.stats)}), so carry no information yet: "
        + (", ".join(f"`{name}`" for name in summary.constant) or "none")
        + ".",
        "",
        "## Correlation with hazard",
        "",
        "Spearman's rank correlation over every bin of an audience; the weighted Pearson "
        "correlation weighs each bin by its viewers at risk. Content features describe what "
        "is on screen and said; the rest say where in the video a bin is, describe the "
        "video as a whole, or describe who arrived and how content interacts with it.",
    ]
    for audience in AUDIENCES:
        if audience not in summary.correlations:
            continue
        for content, title, count in ((True, "content features", 10), (False, "other features", 5)):
            lines += [
                "",
                f"### {audience}: {title}",
                "",
                "| Feature | Kind | Spearman | Weighted Pearson |",
                "| --- | --- | --- | --- |",
            ]
            lines += [
                f"| `{c.name}` | {c.kind} | {_number(c.spearman)} | {_number(c.weighted_pearson)} |"
                for c in top_correlations(summary, audience, content=content, count=count)
            ]
    lines += [
        "",
        "## Distributions",
        "",
        "Over the `all` audience's rows (the other audiences share their content features).",
        "",
        "| Feature | Kind | Mean | SD | Min | Max | Non-zero |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    lines += [
        f"| `{s.name}` | {s.kind} | {s.mean:.3f} | {s.sd:.3f} | {s.low:.3f} | {s.high:.3f} | "
        f"{s.nonzero:.0%} |"
        for s in summary.stats
    ]
    lines += [
        "",
        "## Plots",
        "",
        "![Viewer-weighted mean hazard by bin](hazard-by-bin.png)",
        "",
        "![Strongest content correlations](correlations.png)",
        "",
        "![Distributions of the varying content features](distributions.png)",
        "",
    ]
    return "\n".join(lines)


def plot_hazard(summary: Summary, path: Path) -> None:
    figure = Figure(figsize=(8, 4))
    axes = figure.subplots()
    for audience, hazard in summary.mean_hazard.items():
        axes.plot(range(1, 101), hazard, label=audience)
    axes.set_yscale("symlog", linthresh=1e-3)
    axes.set_xlabel("Bin (1% of the video each)")
    axes.set_ylabel("Hazard (share leaving), symlog")
    axes.set_title("Viewer-weighted mean hazard by bin")
    axes.legend()
    figure.tight_layout()
    figure.savefig(path, dpi=110)


def plot_correlations(summary: Summary, path: Path) -> None:
    audiences = [a for a in AUDIENCES if a in summary.correlations]
    panels = max(len(audiences), 1)
    figure = Figure(figsize=(5 * panels, 5))
    axes = figure.subplots(1, panels)
    for axis, audience in zip(np.atleast_1d(axes), audiences, strict=False):
        top = top_correlations(summary, audience, content=True, count=12)[::-1]
        axis.barh([c.name for c in top], [c.spearman or 0.0 for c in top])
        axis.axvline(0, color="black", linewidth=0.5)
        axis.set_xlim(-1, 1)
        axis.set_title(f"{audience}: Spearman with hazard")
        axis.tick_params(axis="y", labelsize=7)
    figure.tight_layout()
    figure.savefig(path, dpi=110)


def plot_distributions(table: TrainingTable, summary: Summary, path: Path) -> None:
    audience = np.array(table.audience)
    base = table.x[audience == "all"] if np.any(audience == "all") else table.x
    varying = [(i, s) for i, s in enumerate(summary.stats) if s.kind in CONTENT_KINDS and s.sd > 0][
        :40
    ]
    columns = 5
    rows = max(1, -(-len(varying) // columns))
    figure = Figure(figsize=(3 * columns, 2.2 * rows))
    axes = figure.subplots(rows, columns)
    flat = np.atleast_1d(axes).ravel()
    for axis, (index, stats) in zip(flat, varying, strict=False):
        axis.hist(base[:, index], bins=20)
        axis.set_title(stats.name, fontsize=8)
        axis.tick_params(labelsize=6)
    for axis in flat[len(varying) :]:
        axis.axis("off")
    figure.tight_layout()
    figure.savefig(path, dpi=90)


def write_report(
    table: TrainingTable, out: Path, generated: datetime | None = None
) -> tuple[Path, Summary]:
    """Writes `{out}/{feature_version}/README.md` and its plots; returns the folder."""
    summary = summarize(table)
    folder = out / table.feature_version
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "README.md").write_text(render_markdown(summary, generated or datetime.now(UTC)))
    plot_hazard(summary, folder / "hazard-by-bin.png")
    plot_correlations(summary, folder / "correlations.png")
    plot_distributions(table, summary, folder / "distributions.png")
    return folder, summary


Reader = Callable[[Settings, str | None, str | None], TrainingTable]


def bigquery_reader(
    settings: Settings, feature_version: str | None, channel: str | None
) -> TrainingTable:
    client = bigquery.Client(project=settings.project, location=settings.location)
    return read_training_table(client, settings, feature_version, channel)


# The reader the CLI uses; tests replace it.
READER: Reader = bigquery_reader

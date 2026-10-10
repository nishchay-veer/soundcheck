"""Reading the training table and channel contexts from BigQuery.

Both are written by the TypeScript `soundcheck features` command; Python only
reads them.
"""

import json
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any

import numpy as np
from google.cloud import bigquery
from numpy.typing import NDArray

from soundcheck_modeling.settings import Settings

AUDIENCES = ("all", "subscribed", "unsubscribed")

Floats = NDArray[np.float64]


@dataclass(frozen=True)
class TrainingTable:
    feature_version: str
    names: list[str]
    kinds: list[str]
    channel: list[str]
    video: list[str]
    audience: list[str]
    bin: NDArray[np.int64]
    hazard: Floats
    n_at_risk: Floats
    video_views: Floats  # the audience's views of the row's video
    x: Floats  # one row per bin, one column per feature

    @property
    def rows(self) -> int:
        return len(self.hazard)


@dataclass(frozen=True)
class ChannelContext:
    """`feature_contexts`: what the channel's features were measured against."""

    extraction_version: str
    median_target_level: float
    mix_mean: dict[str, float]  # search, suggested, browse
    video_ids: list[str]


def table_from_rows(
    feature_version: str, spec: Mapping[str, Any], rows: Iterable[Mapping[str, Any]]
) -> TrainingTable:
    """A table from `training_bins` rows and the version's spec document."""
    features = spec["features"]
    names = [str(feature["name"]) for feature in features]
    kinds = [str(feature["kind"]) for feature in features]
    channel: list[str] = []
    video: list[str] = []
    audience: list[str] = []
    bins: list[int] = []
    hazard: list[float] = []
    at_risk: list[float] = []
    views: list[float] = []
    x: list[list[float]] = []
    for row in rows:
        vector = [float(value) for value in row["x"]]
        if len(vector) != len(names):
            raise ValueError(
                f"{row['video_id']} {row['audience']} bin {row['bin']}: "
                f"x has {len(vector)} values, the spec {len(names)}"
            )
        channel.append(str(row["channel_id"]))
        video.append(str(row["video_id"]))
        audience.append(str(row["audience"]))
        bins.append(int(row["bin"]))
        hazard.append(float(row["hazard"]))
        at_risk.append(float(row["n_at_risk"]))
        views.append(float(row["video_views"]))
        x.append(vector)
    return TrainingTable(
        feature_version=feature_version,
        names=names,
        kinds=kinds,
        channel=channel,
        video=video,
        audience=audience,
        bin=np.array(bins, dtype=np.int64),
        hazard=np.array(hazard, dtype=np.float64),
        n_at_risk=np.array(at_risk, dtype=np.float64),
        video_views=np.array(views, dtype=np.float64),
        x=np.array(x, dtype=np.float64).reshape(len(hazard), len(names)),
    )


def _parameters(**values: str | None) -> bigquery.QueryJobConfig:
    return bigquery.QueryJobConfig(
        query_parameters=[
            bigquery.ScalarQueryParameter(name, "STRING", value) for name, value in values.items()
        ]
    )


def read_training_table(
    client: bigquery.Client,
    settings: Settings,
    feature_version: str | None = None,
    channel: str | None = None,
) -> TrainingTable:
    """Reads one feature version's rows (the newest version by default) from BigQuery."""
    spec_job = client.query(
        f"SELECT feature_version, spec FROM {settings.table('feature_specs')} "
        "WHERE @version IS NULL OR feature_version = @version "
        "ORDER BY created_at DESC LIMIT 1",
        job_config=_parameters(version=feature_version),
        location=settings.location,
    )
    specs = list(spec_job.result())
    if not specs:
        raise RuntimeError(f"No feature spec for {feature_version or 'any version'}")
    version = str(specs[0]["feature_version"])
    spec = specs[0]["spec"]
    if isinstance(spec, str):
        spec = json.loads(spec)

    rows_job = client.query(
        "SELECT channel_id, video_id, audience, bin, hazard, n_at_risk, video_views, x "
        f"FROM {settings.table('training_bins')} "
        "WHERE feature_version = @version AND (@channel IS NULL OR channel_id = @channel) "
        "ORDER BY channel_id, video_id, audience, bin",
        job_config=_parameters(version=version, channel=channel),
        location=settings.location,
    )
    return table_from_rows(version, spec, rows_job.result())


def read_channel_contexts(
    client: bigquery.Client, settings: Settings, feature_version: str
) -> dict[str, ChannelContext]:
    """Every channel's context for a feature version, by channel ID."""
    job = client.query(
        "SELECT channel_id, extraction_version, median_target_level, mix_mean_search, "
        f"mix_mean_suggested, mix_mean_browse, video_ids FROM {settings.table('feature_contexts')} "
        "WHERE feature_version = @version",
        job_config=_parameters(version=feature_version),
        location=settings.location,
    )
    return {
        str(row["channel_id"]): ChannelContext(
            extraction_version=str(row["extraction_version"]),
            median_target_level=float(row["median_target_level"]),
            mix_mean={
                "search": float(row["mix_mean_search"]),
                "suggested": float(row["mix_mean_suggested"]),
                "browse": float(row["mix_mean_browse"]),
            },
            video_ids=[str(video) for video in row["video_ids"]],
        )
        for row in job.result()
    }

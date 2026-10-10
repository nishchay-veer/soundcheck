from dataclasses import dataclass, field
from datetime import date
from typing import Any

from soundcheck_modeling.data import (
    VideoInfo,
    read_channel_contexts,
    read_videos,
    read_view_percentages,
)
from soundcheck_modeling.settings import Settings

SETTINGS = Settings(project="proj", dataset="ds", location="US")


@dataclass
class Job:
    rows: list[dict[str, Any]]

    def result(self) -> list[dict[str, Any]]:
        return self.rows


@dataclass
class Client:
    """Answers every query with the same rows and records each query's parameters."""

    rows: list[dict[str, Any]]
    calls: list[tuple[str, dict[str, Any]]] = field(default_factory=list)

    def query(self, sql: str, job_config: Any, location: str) -> Job:
        self.calls.append((sql, {p.name: p.value for p in job_config.query_parameters}))
        return Job(self.rows)


def test_videos_come_with_their_publish_date_and_length() -> None:
    client = Client([{"video_id": "v1", "published": date(2022, 5, 8), "duration_s": 262}])
    assert read_videos(client, SETTINGS, "UCx") == [VideoInfo("v1", date(2022, 5, 8), 262.0)]  # type: ignore[arg-type]
    sql, params = client.calls[0]
    assert "`proj.ds.videos`" in sql and params == {"channel": "UCx"}


def test_view_percentages_are_keyed_by_audience_and_skip_unknown_statuses() -> None:
    client = Client(
        [
            {"video_id": "v1", "subscribed_status": "SUBSCRIBED", "average_view_percentage": 43.5},
            {
                "video_id": "v1",
                "subscribed_status": "UNSUBSCRIBED",
                "average_view_percentage": 33.7,
            },
            {"video_id": "v1", "subscribed_status": "OTHER", "average_view_percentage": 1.0},
        ]
    )
    assert read_view_percentages(client, SETTINGS, "UCx") == {  # type: ignore[arg-type]
        ("v1", "subscribed"): 43.5,
        ("v1", "unsubscribed"): 33.7,
    }


def test_channel_contexts_carry_the_curves_data_date() -> None:
    client = Client(
        [
            {
                "channel_id": "UCx",
                "extraction_version": "beats-v5",
                "median_target_level": 1.0,
                "mix_mean_search": 0.16,
                "mix_mean_suggested": 0.07,
                "mix_mean_browse": 0.51,
                "video_ids": ["v1", "v2"],
                "as_of": date(2026, 10, 3),
            }
        ]
    )
    context = read_channel_contexts(client, SETTINGS, "feat-x")["UCx"]  # type: ignore[arg-type]
    assert context.as_of == "2026-10-03"
    assert context.video_ids == ["v1", "v2"]
    assert client.calls[0][1] == {"version": "feat-x"}

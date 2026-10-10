"""Where fits are read from and written to: BigQuery and the raw bucket."""

import json
from collections.abc import Mapping
from typing import Any, cast

from google.cloud import bigquery
from google.cloud.storage import Client as StorageClient

from soundcheck_modeling.contract import POOLED_CHANNEL
from soundcheck_modeling.data import (
    ChannelContext,
    TrainingTable,
    read_channel_contexts,
    read_training_table,
)
from soundcheck_modeling.settings import Settings


class CloudStore:
    """Reads training data and pooled models; writes artifacts and `model_runs` rows."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.bigquery = bigquery.Client(project=settings.project, location=settings.location)
        self.storage = StorageClient(project=settings.project)

    def training_table(self, feature_version: str, channel: str | None) -> TrainingTable:
        return read_training_table(self.bigquery, self.settings, feature_version, channel)

    def channel_contexts(self, feature_version: str) -> dict[str, ChannelContext]:
        return read_channel_contexts(self.bigquery, self.settings, feature_version)

    def save_artifact(self, path: str, artifact: Mapping[str, Any]) -> str:
        blob = self.storage.bucket(self.settings.raw_bucket).blob(path)
        blob.upload_from_string(json.dumps(artifact), content_type="application/json")
        return f"gs://{self.settings.raw_bucket}/{path}"

    def load_artifact(self, uri: str) -> dict[str, Any]:
        bucket, _, path = uri.removeprefix("gs://").partition("/")
        text = self.storage.bucket(bucket).blob(path).download_as_text()
        return cast(dict[str, Any], json.loads(text))

    def append_model_run(self, row: Mapping[str, Any]) -> None:
        # A load job, not a streaming insert, so the row can be deleted at once.
        job = self.bigquery.load_table_from_json(
            [dict(row)],
            self.settings.table_id("model_runs"),
            job_config=bigquery.LoadJobConfig(
                write_disposition=bigquery.WriteDisposition.WRITE_APPEND
            ),
        )
        job.result()

    def latest_pooled_uri(
        self, audience: str, model_version: str, feature_version: str
    ) -> str | None:
        job = self.bigquery.query(
            f"SELECT artifact_uri FROM {self.settings.table('model_runs')} "
            "WHERE channel_id = @pooled AND audience = @audience AND model_version = @model "
            "AND feature_version = @features AND status = 'fitted' "
            "ORDER BY finished_at DESC LIMIT 1",
            job_config=bigquery.QueryJobConfig(
                query_parameters=[
                    bigquery.ScalarQueryParameter("pooled", "STRING", POOLED_CHANNEL),
                    bigquery.ScalarQueryParameter("audience", "STRING", audience),
                    bigquery.ScalarQueryParameter("model", "STRING", model_version),
                    bigquery.ScalarQueryParameter("features", "STRING", feature_version),
                ]
            ),
            location=self.settings.location,
        )
        rows = list(job.result())
        return str(rows[0]["artifact_uri"]) if rows else None

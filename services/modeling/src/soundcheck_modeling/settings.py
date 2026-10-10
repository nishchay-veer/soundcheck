"""Settings from the environment, read in one place (the Python side of rule 4).

Locally, pass the repo's .env: uv run --env-file ../../.env soundcheck-modeling ...
"""

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    project: str
    dataset: str
    location: str
    region: str = "us-central1"
    raw_bucket: str = ""
    # A model trained on fewer videos than this is never shown or shipped.
    min_train_videos: int = 30

    def table(self, name: str) -> str:
        """A table's full name, quoted for SQL."""
        return f"`{self.table_id(name)}`"

    def table_id(self, name: str) -> str:
        """A table's full name, as the client's load jobs take it."""
        return f"{self.project}.{self.dataset}.{name}"


def load_settings(environ: dict[str, str] | None = None) -> Settings:
    env = dict(os.environ) if environ is None else environ
    project = env.get("GCP_PROJECT_ID", "").strip()
    if not project:
        raise RuntimeError("GCP_PROJECT_ID is not set (locally: uv run --env-file ../../.env ...)")
    minimum = env.get("MIN_TRAIN_VIDEOS", "").strip() or "30"
    if not minimum.isdigit():
        raise RuntimeError(f"MIN_TRAIN_VIDEOS must be a whole number, got {minimum!r}")
    return Settings(
        project=project,
        dataset=env.get("BQ_DATASET", "").strip() or "soundcheck",
        location=env.get("BQ_LOCATION", "").strip() or "US",
        region=env.get("GCP_REGION", "").strip() or "us-central1",
        raw_bucket=env.get("GCS_RAW_BUCKET", "").strip() or f"{project}-raw",
        min_train_videos=int(minimum),
    )

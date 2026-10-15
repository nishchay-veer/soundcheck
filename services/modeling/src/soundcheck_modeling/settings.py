"""Settings from the environment, read in one place (the Python side of rule 4).

Locally, pass the repo's .env: uv run --env-file ../../.env soundcheck-modeling ...
"""

import os
from dataclasses import dataclass
from pathlib import Path


def find_repo_root(start: Path) -> Path:
    """The repository root above `start` (the folder with pnpm-workspace.yaml).

    The container holds only the package under /app/src, with no repo around
    it, so there the working directory stands in. The commands that write into
    the repo's docs/ folder (eda, model-card, local evaluate) run in a checkout.
    """
    for folder in start.parents:
        if (folder / "pnpm-workspace.yaml").is_file():
            return folder
    return Path.cwd()


REPO_ROOT = find_repo_root(Path(__file__).resolve())


@dataclass(frozen=True)
class Settings:
    project: str
    dataset: str
    location: str
    region: str = "us-central1"
    raw_bucket: str = ""
    # A model trained on fewer videos than this is never shown or shipped.
    min_train_videos: int = 8
    firestore_database: str = "(default)"
    # Set on Cloud Run jobs by the channel_build workflow (Phase 10).
    channel_id: str | None = None
    run_id: str | None = None
    build_mode: str = "build"

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
    minimum = env.get("MIN_TRAIN_VIDEOS", "").strip() or "8"
    mode = env.get("BUILD_MODE", "").strip() or "build"
    if mode not in ("build", "refresh"):
        raise RuntimeError(f"BUILD_MODE must be build or refresh, got {mode!r}")
    if not minimum.isdigit():
        raise RuntimeError(f"MIN_TRAIN_VIDEOS must be a whole number, got {minimum!r}")
    return Settings(
        project=project,
        dataset=env.get("BQ_DATASET", "").strip() or "soundcheck",
        location=env.get("BQ_LOCATION", "").strip() or "US",
        region=env.get("GCP_REGION", "").strip() or "us-central1",
        raw_bucket=env.get("GCS_RAW_BUCKET", "").strip() or f"{project}-raw",
        min_train_videos=int(minimum),
        firestore_database=env.get("FIRESTORE_DATABASE", "").strip() or "(default)",
        channel_id=env.get("CHANNEL_ID", "").strip() or None,
        run_id=env.get("RUN_ID", "").strip() or None,
        build_mode=mode,
    )

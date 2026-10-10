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

    def table(self, name: str) -> str:
        """A table's full name, quoted for SQL."""
        return f"`{self.project}.{self.dataset}.{name}`"


def load_settings(environ: dict[str, str] | None = None) -> Settings:
    env = dict(os.environ) if environ is None else environ
    project = env.get("GCP_PROJECT_ID", "").strip()
    if not project:
        raise RuntimeError("GCP_PROJECT_ID is not set (locally: uv run --env-file ../../.env ...)")
    return Settings(
        project=project,
        dataset=env.get("BQ_DATASET", "").strip() or "soundcheck",
        location=env.get("BQ_LOCATION", "").strip() or "US",
    )

"""Logging fits to Vertex AI Experiments (`soundcheck-models`)."""

import re
from collections.abc import Mapping
from typing import Protocol

EXPERIMENT = "soundcheck-models"

Value = str | int | float


class ExperimentLog(Protocol):
    def log(self, run_name: str, params: Mapping[str, Value], metrics: Mapping[str, Value]) -> None:
        """Records one fit as an experiment run."""


def run_name(channel: str, audience: str, run_id: str) -> str:
    """A run name Vertex accepts: lowercase letters, digits and hyphens, at most 128."""
    name = re.sub(r"[^a-z0-9-]", "-", f"{channel}-{audience}-{run_id[:12]}".lower())
    return name.strip("-")[:128]


class VertexExperiments:
    """
    Parameters and metrics only. No backing TensorBoard is created
    (`experiment_tensorboard=False`): it is billed, and nothing here logs time series.
    """

    def __init__(self, project: str, region: str) -> None:
        self.project = project
        self.region = region
        self._ready = False

    def log(self, run_name: str, params: Mapping[str, Value], metrics: Mapping[str, Value]) -> None:
        # Imported here: the SDK is slow to import and only this needs it.
        from google.cloud import aiplatform

        if not self._ready:
            aiplatform.init(
                project=self.project,
                location=self.region,
                experiment=EXPERIMENT,
                experiment_description="Soundcheck per-audience hazard models (Phase 08)",
                experiment_tensorboard=False,
            )
            self._ready = True
        aiplatform.start_run(run_name)
        try:
            aiplatform.log_params(dict(params))
            aiplatform.log_metrics(dict(metrics))
        finally:
            aiplatform.end_run()

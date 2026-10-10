"""What TypeScript exports for the fitter (`pnpm gen:schemas`): the model's
columns and settings, and the JSON Schemas artifacts and `model_runs` rows are
validated against before they are written (rule 3).
"""

import json
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from jsonschema.validators import validator_for

SCHEMAS_DIR = Path(__file__).resolve().parents[2] / "schemas"
POOLED_CHANNEL = "pooled"


@dataclass(frozen=True)
class EvaluationSplit:
    """Phase 09's split; TypeScript's `evaluationTestVideos` uses the same numbers."""

    min_test_videos: int = 6
    test_share: float = 0.2
    min_age_days: int = 14


@dataclass(frozen=True)
class ModelConfig:
    model_version: str
    feature_version: str
    columns: dict[str, list[str]]  # by audience
    unpenalized: list[str]
    lambdas: list[float]
    pooled_lambda: float
    folds: int
    evaluation: EvaluationSplit = field(default_factory=EvaluationSplit)


def _load(name: str, directory: Path) -> Any:
    return json.loads((directory / name).read_text())


def load_config(directory: Path = SCHEMAS_DIR) -> ModelConfig:
    raw = _load("model-config.json", directory)
    return ModelConfig(
        model_version=str(raw["modelVersion"]),
        feature_version=str(raw["featureVersion"]),
        columns={audience: [str(c) for c in names] for audience, names in raw["columns"].items()},
        unpenalized=[str(name) for name in raw["unpenalized"]],
        lambdas=[float(lam) for lam in raw["lambdas"]],
        pooled_lambda=float(raw["pooledLambda"]),
        folds=int(raw["folds"]),
        evaluation=EvaluationSplit(
            min_test_videos=int(raw["evaluation"]["minTestVideos"]),
            test_share=float(raw["evaluation"]["testShare"]),
            min_age_days=int(raw["evaluation"]["minAgeDays"]),
        ),
    )


def _check(schema_name: str, value: Mapping[str, Any], directory: Path) -> list[str]:
    schema = _load(schema_name, directory)
    validator = validator_for(schema)(schema)
    return [
        f"{'/'.join(str(part) for part in error.absolute_path) or '(root)'}: {error.message}"
        for error in validator.iter_errors(value)
    ]


def validate_artifact(artifact: Mapping[str, Any], directory: Path = SCHEMAS_DIR) -> None:
    """Raises ValueError unless the artifact matches the JSON Schema and is consistent."""
    problems = _check("model-artifact.schema.json", artifact, directory)
    if not problems:
        # The checks zod makes with superRefine, which a JSON Schema cannot express.
        p = len(artifact["featureNames"])
        for key in ("mean", "sd", "beta"):
            if len(artifact[key]) != p:
                problems.append(f"{key} has {len(artifact[key])} values, not {p}")
        cov = artifact["cov"]
        if len(cov) != p + 1 or any(len(row) != p + 1 for row in cov):
            problems.append(f"cov must be {p + 1} by {p + 1}")
        if len(set(artifact["featureNames"])) != p:
            problems.append("featureNames repeat a column")
        if not set(artifact["unpenalized"]) <= set(artifact["featureNames"]):
            problems.append("unpenalized columns not in the model")
        if artifact["usable"] == (len(artifact["unusableReasons"]) > 0):
            problems.append("usable must hold exactly when there are no unusable reasons")
        if (artifact["channelId"] is None) != (artifact["channelContext"] is None):
            problems.append("the pooled model, and only it, has no channel context")
    if problems:
        raise ValueError("Invalid model artifact: " + "; ".join(problems))


def validate_model_run(row: Mapping[str, Any], directory: Path = SCHEMAS_DIR) -> None:
    problems = _check("model-run-row.schema.json", row, directory)
    if problems:
        raise ValueError("Invalid model_runs row: " + "; ".join(problems))

"""Writes tests/fixtures/parity/artifact.json and expected.json for the
cross-language parity test (Phase 08).

Reads frame.json (a feature frame the TypeScript featurizer wrote), fits a
newcomer model on synthetic training rows with the fitter, and writes the
artifact and the hazards the fitter predicts for that frame. The TypeScript
runtime must reproduce them from the artifact within 1e-9. The synthetic rows
are test data around the frame's columns; no feature is computed here.

Run after `pnpm --filter @soundcheck/scripts parity-frame`, from services/modeling:
    uv run python scripts/parity_fixture.py
"""

import json
from datetime import UTC, datetime
from pathlib import Path

import numpy as np

from soundcheck_modeling.contract import load_config, validate_artifact
from soundcheck_modeling.data import ChannelContext
from soundcheck_modeling.fit import fit_model, video_weights
from soundcheck_modeling.train import artifact_document

PARITY = Path(__file__).resolve().parents[3] / "tests" / "fixtures" / "parity"
SEED = 20261011
CHANNEL = "UCparityParityParity0000"
VIDEOS = 40
AT_RISK = 1000


def main() -> None:
    frame = json.loads((PARITY / "frame.json").read_text())
    names: list[str] = frame["columns"]
    rows: int = frame["rows"]
    values = np.array(frame["values"], dtype=np.float64).reshape(len(names), rows).T
    config = load_config()
    columns = config.columns[frame["audience"]]
    frame_x = values[:, [names.index(name) for name in columns]]

    # Synthetic videos: the frame's columns with noise, so every column varies,
    # and hazards drawn from a logistic model with random coefficients.
    rng = np.random.default_rng(SEED)
    spread = frame_x.std(axis=0) + 0.1
    x = np.vstack([frame_x + rng.normal(0, 0.3, frame_x.shape) * spread for _ in range(VIDEOS)])
    truth = rng.normal(0, 0.15, len(columns)) / spread
    probability = 1 / (1 + np.exp(-(-4 + (x - x.mean(axis=0)) @ truth)))
    h = rng.binomial(AT_RISK, probability) / AT_RISK
    videos = [f"parity-v{v:02d}" for v in range(VIDEOS) for _ in range(rows)]
    w = video_weights(videos, np.full(len(h), float(AT_RISK)), np.full(len(h), 5000.0))

    fit = fit_model(x, columns, h, w, lam=3.0, unpenalized=config.unpenalized)
    if not fit.converged:
        raise SystemExit(f"The parity fit did not converge (gradient {fit.gradient_norm:.2e})")
    artifact = artifact_document(
        config,
        run_id="parity",
        channel=CHANNEL,
        audience=frame["audience"],
        fit=fit,
        metrics={
            "rows": len(h),
            "videos": VIDEOS,
            "trainLoss": fit.train_loss,
            "cv": [],
            "folds": 0,
            "iterations": fit.iterations,
            "converged": fit.converged,
            "gradientNorm": fit.gradient_norm,
        },
        extraction="beats-v5",
        prior_ref=None,
        channels=[CHANNEL],
        videos=sorted(set(videos)),
        context=ChannelContext(
            extraction_version="beats-v5",
            median_target_level=2.0,
            mix_mean={"search": 0.2, "suggested": 0.3, "browse": 0.4},
            video_ids=[],
        ),
        reasons=["a parity fixture, fitted on synthetic data"],
        created=datetime(2026, 10, 11, tzinfo=UTC),
    )
    validate_artifact(artifact)
    hazards = fit.predict(frame_x)
    (PARITY / "artifact.json").write_text(json.dumps(artifact, indent=2) + "\n")
    (PARITY / "expected.json").write_text(
        json.dumps(
            {
                "description": "Hazards and survival the fitter predicts for frame.json",
                "hazards": hazards.tolist(),
                "survival": np.cumprod(1 - hazards).tolist(),
            },
            indent=2,
        )
        + "\n"
    )
    print(f"wrote {PARITY}/artifact.json ({len(fit.names)} columns) and expected.json")


if __name__ == "__main__":
    main()

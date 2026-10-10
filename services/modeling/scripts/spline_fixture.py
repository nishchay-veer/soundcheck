"""Writes tests/fixtures/spline.json: the position spline's full B-spline basis,
evaluated by scipy at 101 points from 0 to 1.

It is a test oracle for packages/core/src/features/spline.ts, which must match
within 1e-12. It computes no feature: the TypeScript featurizer is the only one.
The knots must equal POSITION_SPLINE in packages/core/src/features/spec.ts; the
TypeScript test checks the fixture's knots against it.

Run from services/modeling: uv run python scripts/spline_fixture.py
"""

import json
from pathlib import Path

import numpy as np
import scipy
from scipy.interpolate import BSpline

DEGREE = 3
INTERIOR_KNOTS = [0.25, 0.5, 0.75]
POINTS = 101
OUT = Path(__file__).resolve().parents[3] / "tests" / "fixtures" / "spline.json"


def main() -> None:
    knots = [0.0] * (DEGREE + 1) + INTERIOR_KNOTS + [1.0] * (DEGREE + 1)
    count = len(knots) - DEGREE - 1
    x = np.linspace(0.0, 1.0, POINTS)
    # Identity coefficients evaluate every basis function at once: one column each.
    basis = BSpline(np.array(knots), np.eye(count), DEGREE)(x)
    fixture = {
        "generator": f"scipy {scipy.__version__} BSpline, scripts/spline_fixture.py",
        "degree": DEGREE,
        "knots": knots,
        "x": x.tolist(),
        "basis": basis.tolist(),
    }
    OUT.write_text(json.dumps(fixture, indent=2) + "\n")
    print(f"wrote {OUT} ({POINTS} points, {count} basis functions)")


if __name__ == "__main__":
    main()

import numpy as np
import pytest
from scipy.special import expit

from soundcheck_modeling.fit import (
    Problem,
    cross_validate,
    fit_model,
    hessian,
    objective,
    video_folds,
    video_weights,
)

NAMES = ["pos", "energy", "sponsor", "static"]
TRUE_ALPHA = -3.5
TRUE_BETA = np.array([0.8, -0.3, 0.6, 0.15])  # per unit of each column


def synthetic(videos: int = 60, at_risk: float = 20_000.0, seed: int = 1):
    """
    Videos of 100 bins whose hazards follow known coefficients. Leavers are
    drawn binomially from the viewers at risk, so the fitter sees the same
    noise a real curve has.
    """
    rng = np.random.default_rng(seed)
    rows = videos * 100
    position = np.tile(np.arange(100) / 100, videos)
    x = np.column_stack(
        [
            position,
            rng.integers(1, 6, rows).astype(float),  # energy, 1 to 5
            (rng.random(rows) < 0.1).astype(float),  # sponsor share
            rng.normal(1.0, 0.8, rows).clip(0),  # log static run
        ]
    )
    true = expit(TRUE_ALPHA + x @ TRUE_BETA)
    n = np.full(rows, at_risk)
    h = rng.binomial(n.astype(int), true) / n
    video_ids = np.repeat([f"vid{v:03d}" for v in range(videos)], 100).tolist()
    return x, h, n, video_ids


def test_recovers_known_coefficients_within_tolerance() -> None:
    """The most important test in the repo: the fitter finds the coefficients that made the data."""
    x, h, n, _ = synthetic()
    fit = fit_model(x, NAMES, h, n, lam=1e-6)
    assert fit.converged
    raw = fit.raw_coefficients()
    for name, truth in zip(NAMES, TRUE_BETA, strict=True):
        assert raw[name] == pytest.approx(truth, abs=0.02), name
    intercept = fit.alpha - float(np.sum(fit.beta * fit.mean / fit.sd))
    assert intercept == pytest.approx(TRUE_ALPHA, abs=0.03)


def test_the_covariance_is_honest_about_the_estimates_spread() -> None:
    """
    With the production weights (log(1 + views) per video, which are not
    counts of anything), coefficients scatter across repeated datasets as the
    dispersion-scaled covariance says they should.
    """
    estimates = []
    variances = []
    for seed in range(40):
        x, h, n, videos = synthetic(videos=20, at_risk=2_000.0, seed=seed)
        w = video_weights(videos, n, np.full(len(n), 5_000.0))
        fit = fit_model(x, NAMES, h, w, lam=1e-6)
        estimates.append(fit.beta / fit.sd)
        variances.append(np.diag(fit.cov)[1:] / fit.sd**2)
    spread = np.std(estimates, axis=0)
    predicted = np.sqrt(np.mean(variances, axis=0))
    assert spread == pytest.approx(predicted, rel=0.35)


def test_binomial_counts_as_weights_give_a_dispersion_near_one() -> None:
    x, h, n, _ = synthetic(videos=20, at_risk=2_000.0)
    fit = fit_model(x, NAMES, h, n, lam=1e-6)
    assert fit.dispersion == pytest.approx(1.0, abs=0.15)
    assert fit.effective_parameters == pytest.approx(len(NAMES) + 1, abs=0.01)


def test_the_covariance_does_not_depend_on_the_weights_scale() -> None:
    x, h, n, videos = synthetic(videos=20, at_risk=2_000.0)
    w = video_weights(videos, n, np.full(len(n), 5_000.0))
    small = fit_model(x, NAMES, h, w / 1_000, lam=1e-9)
    large = fit_model(x, NAMES, h, w * 1_000, lam=1e-9)
    assert small.beta == pytest.approx(large.beta, rel=1e-6)
    assert small.cov == pytest.approx(large.cov, rel=1e-4)
    assert small.dispersion == pytest.approx(large.dispersion / 1e6, rel=1e-4)


def _problem(seed: int = 3) -> tuple[Problem, np.ndarray]:
    rng = np.random.default_rng(seed)
    z = rng.normal(size=(200, 4))
    h = rng.uniform(0, 0.2, 200)
    w = rng.uniform(0.5, 2.0, 200)
    problem = Problem(
        z=z,
        h=h,
        w=w,
        lam=2.5,
        penalized=np.array([0.0, 1.0, 1.0, 1.0]),
        beta0=np.array([0.0, 0.3, -0.1, 0.0]),
    )
    return problem, rng.normal(scale=0.5, size=5)


def test_analytic_gradient_matches_finite_differences() -> None:
    problem, theta = _problem()
    _, gradient = objective(theta, problem)
    step = 1e-6
    numeric = np.array(
        [
            (objective(theta + step * e, problem)[0] - objective(theta - step * e, problem)[0])
            / (2 * step)
            for e in np.eye(len(theta))
        ]
    )
    assert gradient == pytest.approx(numeric, rel=1e-6, abs=1e-6)


def test_analytic_hessian_matches_finite_differences_of_the_gradient() -> None:
    problem, theta = _problem()
    step = 1e-6
    numeric = np.column_stack(
        [
            (objective(theta + step * e, problem)[1] - objective(theta - step * e, problem)[1])
            / (2 * step)
            for e in np.eye(len(theta))
        ]
    )
    assert hessian(theta, problem) == pytest.approx(numeric, rel=1e-5, abs=1e-5)


def test_drops_columns_that_never_vary_and_leaves_unpenalized_ones_alone() -> None:
    x, h, n, _ = synthetic(videos=10)
    with_constant = np.column_stack([x, np.zeros(len(h))])
    # The data weighs about 2e7 (20,000 viewers in each of 1,000 bins), so 1e12 dominates it.
    fit = fit_model(with_constant, [*NAMES, "never"], h, n, lam=1e12, unpenalized=["pos"])
    assert fit.names == NAMES
    assert fit.dropped == ["never"]
    # A huge penalty shrinks the penalized coefficients to 0 but not the unpenalized one.
    raw = fit.raw_coefficients()
    assert abs(raw["energy"]) < 1e-3
    assert raw["pos"] == pytest.approx(TRUE_BETA[0], abs=0.1)


def test_a_prior_pulls_coefficients_toward_it_in_raw_units() -> None:
    x, h, n, _ = synthetic(videos=10)
    prior = {"energy": 0.5, "sponsor": -1.0}
    fit = fit_model(x, NAMES, h, n, lam=1e12, unpenalized=["pos"], prior=prior)
    raw = fit.raw_coefficients()
    assert raw["energy"] == pytest.approx(0.5, abs=1e-3)
    assert raw["sponsor"] == pytest.approx(-1.0, abs=1e-3)
    assert raw["static"] == pytest.approx(0.0, abs=1e-3)


def test_reports_a_fit_that_did_not_converge() -> None:
    x, h, n, _ = synthetic(videos=10)
    fit = fit_model(x, NAMES, h, n, lam=1.0, max_iterations=1, newton_steps=0)
    assert not fit.converged
    assert fit.gradient_norm > 0


def test_weights_follow_viewers_at_risk_and_cap_each_video_at_log_views() -> None:
    videos = ["a", "a", "b", "b", "c"]
    n = np.array([100.0, 50.0, 10.0, 10.0, 0.0])
    views = np.array([1000.0, 1000.0, 20.0, 20.0, 5.0])
    w = video_weights(videos, n, views)
    assert w[:2] == pytest.approx(np.log1p(1000) * np.array([2, 1]) / 3)
    assert w[2:4] == pytest.approx([np.log1p(20) / 2] * 2)
    assert w[4] == 0.0


def test_folds_hold_out_whole_videos_and_shrink_with_few_videos() -> None:
    videos = [f"v{i}" for i in range(12) for _ in range(3)]
    folds = video_folds(videos, 5)
    assert len(folds) == 5
    assert sorted(v for fold in folds for v in fold) == sorted(set(videos))
    assert len(video_folds(["a", "b", "c"], 5)) == 3
    assert video_folds(["a", "a"], 5) == []


def test_cross_validation_scores_every_lambda_and_prefers_the_better_one() -> None:
    x, h, n, videos = synthetic(videos=15, at_risk=500.0)
    # Pure-noise columns make a light penalty overfit less than a crushing one underfits.
    result = cross_validate(x, NAMES, h, n, videos, [0.1, 1e6], folds=5, unpenalized=["pos"])
    assert result.folds == 5
    assert [lam for lam, _ in result.losses] == [0.1, 1e6]
    assert result.chosen == 0.1
    single = cross_validate(x[:100], NAMES, h[:100], n[:100], videos[:100], [1.0], folds=5)
    assert single.folds == 0 and single.losses == [(1.0, None)] and single.chosen == 10.0

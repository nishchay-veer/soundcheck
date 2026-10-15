"""The discrete-time hazard model (Phase 08).

A fractional-response logistic regression on binned hazards: for each bin,
logit h = alpha + beta . z, where z is the feature vector standardized with
the training rows' mean and standard deviation. Fitted by maximizing the
weighted fractional log-likelihood

    sum w * (h * log p + (1 - h) * log(1 - p)) - 0.5 * lambda * |beta - beta0|^2

over penalized columns, with the analytic gradient, then polished with
Newton steps. Its covariance is the Laplace approximation, the inverse of the
analytic Hessian X^T W X + lambda * P with W = w * p * (1 - p), scaled by the
quasi-likelihood dispersion: the weighted Pearson scatter of the hazards
around the fit per residual degree of freedom. The weights only fix how much
each bin and video counts relative to the others (log(1 + views) per video is
a choice, not a count of observations), so the scatter sets their scale and
the covariance does not depend on it. Reads features; never computes one.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import cast

import numpy as np
from scipy.optimize import minimize
from scipy.special import expit

from soundcheck_modeling.data import Floats

# A column whose standard deviation is below this never varies: it is dropped.
MIN_SD = 1e-12
# Converged when the largest gradient component is below this times the total weight.
GRADIENT_TOLERANCE = 1e-7
NEWTON_STEPS = 50
# A perfect fit has no scatter; this keeps its covariance positive definite.
MIN_DISPERSION = 1e-12
# Predicted hazards are kept this far from 0 and 1 in the dispersion.
MIN_HAZARD = 1e-12
# Videos are shuffled into folds with this seed, so folds are reproducible.
FOLD_SEED = 20261010


@dataclass(frozen=True)
class Problem:
    """One fit in standardized units: rows by kept columns."""

    z: Floats
    h: Floats
    w: Floats
    lam: float
    penalized: Floats  # 1 for a penalized column, 0 for one the penalty leaves alone
    beta0: Floats  # the prior mean of beta


def objective(theta: Floats, problem: Problem) -> tuple[float, Floats]:
    """Penalized negative log-likelihood and its gradient; theta is (alpha, beta)."""
    eta = theta[0] + problem.z @ theta[1:]
    # -(h * log p + (1 - h) * log(1 - p)) = log(1 + e^eta) - h * eta, without overflow.
    loss = float(np.sum(problem.w * (np.logaddexp(0.0, eta) - problem.h * eta)))
    shrink = problem.penalized * (theta[1:] - problem.beta0)
    loss += 0.5 * problem.lam * float(shrink @ shrink)
    residual = problem.w * (expit(eta) - problem.h)
    gradient = np.concatenate(([residual.sum()], problem.z.T @ residual + problem.lam * shrink))
    return loss, gradient


def hessian(theta: Floats, problem: Problem) -> Floats:
    """X^T W X + lambda * P, with X the design with an intercept column."""
    p = expit(theta[0] + problem.z @ theta[1:])
    v = problem.w * p * (1.0 - p)
    design = np.column_stack([np.ones(len(p)), problem.z])
    result = design.T @ (design * v[:, None])
    result[1:, 1:] += problem.lam * np.diag(problem.penalized)
    return cast(Floats, result)


@dataclass(frozen=True)
class Fit:
    names: list[str]  # the columns kept, in coefficient order
    dropped: list[str]  # columns left out because they never vary
    columns: list[int]  # where the kept columns are in the input
    mean: Floats
    sd: Floats
    alpha: float
    beta: Floats
    cov: Floats  # of (alpha, beta), intercept first
    lam: float
    converged: bool
    iterations: int
    gradient_norm: float
    train_loss: float  # weighted mean negative log-likelihood, without the penalty
    dispersion: float  # what the inverse Hessian is scaled by
    effective_parameters: float  # trace of the hat matrix: below the column count when penalized

    def linear(self, x: Floats) -> Floats:
        """The logit of the hazard for rows of the input's columns."""
        z = (x[:, self.columns] - self.mean) / self.sd
        return self.alpha + z @ self.beta

    def predict(self, x: Floats) -> Floats:
        return cast(Floats, expit(self.linear(x)))

    def raw_coefficients(self) -> dict[str, float]:
        """Coefficients per unit of each column, for use as another model's prior."""
        return {
            name: float(b / s) for name, b, s in zip(self.names, self.beta, self.sd, strict=True)
        }


def mean_loss(eta: Floats, h: Floats, w: Floats) -> float:
    """Weighted mean negative log-likelihood of logits `eta`."""
    total = w.sum()
    if total <= 0:
        return float("nan")
    return float(np.sum(w * (np.logaddexp(0.0, eta) - h * eta)) / total)


def fit_model(
    x: Floats,
    names: Sequence[str],
    h: Floats,
    w: Floats,
    lam: float,
    unpenalized: Sequence[str] = (),
    prior: Mapping[str, float] | None = None,
    max_iterations: int = 1000,
    newton_steps: int = NEWTON_STEPS,
) -> Fit:
    """Fits one model. `prior` gives coefficients per unit of a column (0 when absent)."""
    mean = x.mean(axis=0)
    sd = x.std(axis=0)
    keep = sd > MIN_SD
    columns = [int(i) for i in np.flatnonzero(keep)]
    kept = [names[i] for i in columns]
    z = (x[:, columns] - mean[columns]) / sd[columns]
    penalized = np.array([0.0 if name in unpenalized else 1.0 for name in kept])
    beta0 = np.array(
        [(prior or {}).get(name, 0.0) * sd[i] for name, i in zip(kept, columns, strict=True)]
    )
    problem = Problem(z=z, h=h, w=w, lam=lam, penalized=penalized, beta0=beta0)

    rate = float(np.clip(np.average(h, weights=w) if w.sum() > 0 else 0.5, 1e-6, 1 - 1e-6))
    start = np.concatenate(([np.log(rate / (1 - rate))], beta0))
    result = minimize(
        objective,
        start,
        args=(problem,),
        jac=True,
        method="L-BFGS-B",
        options={"maxiter": max_iterations, "ftol": 1e-15, "gtol": 1e-10, "maxcor": 30},
    )
    theta = np.asarray(result.x, dtype=np.float64)
    iterations = int(result.nit)

    # The problem is convex, so Newton steps from here reach the optimum to
    # machine precision, which the covariance and the parity test rely on.
    # (L-BFGS-B often reports a line-search failure right at the optimum, so
    # convergence is judged below by the gradient, not by its status.)
    for _ in range(newton_steps):
        loss, gradient = objective(theta, problem)
        if np.max(np.abs(gradient)) <= 1e-12 * max(1.0, float(w.sum())):
            break
        try:
            step = np.linalg.solve(hessian(theta, problem), gradient)
        except np.linalg.LinAlgError:
            # A singular Hessian (unpenalized columns that move together, as a few
            # near-identical videos can make them): keep L-BFGS-B's answer. The
            # check below then reports the fit as not converged.
            break
        size = 1.0
        while size > 1e-10 and objective(theta - size * step, problem)[0] > loss:
            size /= 2
        theta = theta - size * step
        iterations += 1

    _, gradient = objective(theta, problem)
    gradient_norm = float(np.max(np.abs(gradient)))
    information = hessian(theta, problem)
    try:
        np.linalg.cholesky(information)
        positive_definite = True
    except np.linalg.LinAlgError:
        positive_definite = False
    converged = positive_definite and gradient_norm <= GRADIENT_TOLERANCE * max(1.0, float(w.sum()))
    unscaled = np.linalg.pinv(information)
    eta = theta[0] + z @ theta[1:]
    dispersion, effective = quasi_dispersion(problem, theta, information, unscaled)
    cov = dispersion * unscaled
    return Fit(
        names=kept,
        dropped=[name for name, k in zip(names, keep, strict=True) if not k],
        columns=columns,
        mean=mean[columns],
        sd=sd[columns],
        alpha=float(theta[0]),
        beta=theta[1:],
        cov=(cov + cov.T) / 2,
        lam=lam,
        converged=converged,
        iterations=iterations,
        gradient_norm=gradient_norm,
        train_loss=mean_loss(eta, h, w),
        dispersion=dispersion,
        effective_parameters=effective,
    )


def quasi_dispersion(
    problem: Problem, theta: Floats, information: Floats, unscaled: Floats
) -> tuple[float, float]:
    """
    The Pearson dispersion sum w * (h - p)^2 / (p * (1 - p)) / (n - k) over
    rows with weight, with k the effective number of parameters,
    trace((X^T W X + lambda * P)^-1 X^T W X). Returns (dispersion, k).
    """
    # A hazard predicted as exactly 0 or 1 would divide by zero.
    p = np.clip(expit(theta[0] + problem.z @ theta[1:]), MIN_HAZARD, 1 - MIN_HAZARD)
    rows = problem.w > 0
    pearson = float(
        np.sum(problem.w[rows] * (problem.h[rows] - p[rows]) ** 2 / (p[rows] * (1 - p[rows])))
    )
    penalty = np.zeros(len(theta))
    penalty[1:] = problem.lam * problem.penalized
    # X^T W X is the Hessian without its penalty.
    effective = float(np.trace(unscaled @ (information - np.diag(penalty))))
    freedom = max(float(rows.sum()) - effective, 1.0)
    return max(pearson / freedom, MIN_DISPERSION), effective


def video_weights(videos: Sequence[str], n_at_risk: Floats, views: Floats) -> Floats:
    """
    Row weights: within a video proportional to viewers at risk, and each
    video's total equal to log(1 + views), so one viral video cannot dominate.
    A video with nobody at risk gets no weight.
    """
    labels = np.asarray(videos)
    weights = np.zeros(len(n_at_risk))
    for video in np.unique(labels):
        rows = labels == video
        at_risk = n_at_risk[rows].sum()
        if at_risk > 0:
            weights[rows] = np.log1p(views[rows][0]) * n_at_risk[rows] / at_risk
    return weights


def video_folds(videos: Sequence[str], folds: int) -> list[list[str]]:
    """Videos split into at most `folds` groups (fewer with fewer videos); none below 2 videos."""
    unique = sorted(set(videos))
    count = min(folds, len(unique))
    if count < 2:
        return []
    order = np.random.default_rng(FOLD_SEED).permutation(len(unique))
    return [sorted(unique[i] for i in order[fold::count]) for fold in range(count)]


@dataclass(frozen=True)
class CrossValidation:
    losses: list[tuple[float, float | None]]  # (lambda, held-out loss); None without folds
    folds: int
    chosen: float


def cross_validate(
    x: Floats,
    names: Sequence[str],
    h: Floats,
    w: Floats,
    videos: Sequence[str],
    lambdas: Sequence[float],
    folds: int,
    unpenalized: Sequence[str] = (),
    prior: Mapping[str, float] | None = None,
    default: float = 10.0,
) -> CrossValidation:
    """
    Chooses lambda by cross-validation grouped by video: each fold's videos are
    held out whole, and lambda is scored by the held-out weighted mean
    negative log-likelihood. Ties go to the larger lambda. Without at least two
    videos there is nothing to hold out, and `default` is used.
    """
    groups = video_folds(videos, folds)
    if not groups:
        return CrossValidation(losses=[(lam, None) for lam in lambdas], folds=0, chosen=default)
    labels = np.asarray(videos)
    losses: list[tuple[float, float | None]] = []
    for lam in lambdas:
        total = 0.0
        weight = 0.0
        for held_out in groups:
            test = np.isin(labels, held_out)
            fit = fit_model(x[~test], names, h[~test], w[~test], lam, unpenalized, prior)
            fold_weight = float(w[test].sum())
            if fold_weight > 0:
                total += mean_loss(fit.linear(x[test]), h[test], w[test]) * fold_weight
                weight += fold_weight
        losses.append((lam, total / weight if weight > 0 else None))
    scored = [(loss, lam) for lam, loss in losses if loss is not None]
    chosen = min(scored, key=lambda pair: (pair[0], -pair[1]))[1] if scored else default
    return CrossValidation(losses=losses, folds=len(groups), chosen=chosen)

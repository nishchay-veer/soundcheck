"""Held-out evaluation of the audience model (Phase 09).

Per channel, videos are split by time: the newest 20% (at least 6), leaving
out videos under 14 days old, are the test set, and the model is refitted on
the rest only. A channel too small for that runs in check mode instead: each
video is held out in turn, so every step runs, but the numbers are a pipeline
check, not a result.

Each test video is scored for each audience against its measured curve, next
to the baselines: B0 the channel's average curve (or its 10 nearest-length
videos, whichever is stronger), B1 a generic LLM's guess (from TypeScript),
and B2 the model without content features. The 80% bands are checked for
coverage, and a paired bootstrap says whether the model beats B0. Predictions
use the fitter's linear form, which the parity test ties to the TypeScript
runtime. Nothing here computes a feature.
"""

import math
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date
from typing import Literal, cast

import numpy as np
from scipy.special import expit

from soundcheck_modeling.contract import EvaluationSplit, ModelConfig
from soundcheck_modeling.data import AUDIENCES, Floats, TrainingTable, VideoInfo
from soundcheck_modeling.eda import spearman
from soundcheck_modeling.fit import Fit, cross_validate, fit_model, video_weights
from soundcheck_modeling.train import MIN_POOLED_CHANNELS

# The newest share of a fold's training videos that checks band coverage.
VALIDATION_SHARE = 0.2
DEFAULT_SPLIT = EvaluationSplit()
BAND = (0.1, 0.9)  # the 80% band
COVERAGE_TARGET = (0.7, 0.9)
DRAWS = 200
RESAMPLES = 2000
PEAKS = 3
PEAK_GAP = 4  # bins between two drop-off peaks
PEAK_TOLERANCE = 3  # bins a predicted peak may be from an actual one
B0_NEIGHBOURS = 10
SEED = 20261010
# Columns B2 keeps: where in the video a bin is, and its length.
POSITION_KINDS = frozenset({"position", "spline"})

Mode = Literal["holdout", "check"]


@dataclass(frozen=True)
class Fold:
    train: list[str]
    test: list[str]


@dataclass(frozen=True)
class Split:
    mode: Mode
    folds: list[Fold]
    too_new: list[str]
    reason: str | None  # why the channel runs in check mode


def choose_split(
    videos: Sequence[VideoInfo],
    as_of: date,
    min_train: int,
    rule: EvaluationSplit = DEFAULT_SPLIT,
) -> Split:
    """
    The newest 20% (at least 6) of settled videos as the test set, or check
    mode. TypeScript's `evaluationTestVideos` applies the same rule, so the
    generic-LLM baseline is asked about the same videos.
    """
    settled = sorted(
        (v for v in videos if (as_of - v.published).days >= rule.min_age_days),
        key=lambda v: (v.published, v.video_id),
    )
    too_new = sorted(v.video_id for v in videos if (as_of - v.published).days < rule.min_age_days)
    ids = [v.video_id for v in settled]
    tested = max(rule.min_test_videos, math.ceil(rule.test_share * len(ids)))
    if len(ids) - tested >= min_train:
        return Split("holdout", [Fold(ids[:-tested], ids[-tested:])], too_new, None)
    if len(ids) < 2:
        raise ValueError(f"Evaluation needs at least 2 settled videos; there are {len(ids)}")
    reason = (
        f"{len(ids)} settled videos: a held-out test needs {rule.min_test_videos} test videos "
        f"and {min_train} training videos"
    )
    return Split("check", [Fold([i for i in ids if i != t], [t]) for t in ids], too_new, reason)


# Curves --------------------------------------------------------------------


def survival(hazard: Floats) -> Floats:
    return np.cumprod(1.0 - hazard, axis=-1)


def hazard_of(curve: Floats) -> Floats:
    before = np.concatenate(([1.0], curve[:-1]))
    return np.where(before > 0, 1.0 - curve / np.where(before > 0, before, 1.0), 0.0)


def curve_mae(predicted: Floats, actual: Floats) -> float:
    """Mean absolute difference over bins 2 to 100, in percentage points."""
    return float(100 * np.mean(np.abs(predicted[1:] - actual[1:])))


def retention_error(predicted: Floats, actual: Floats) -> float:
    """Difference of the curves' averages (the share watched), in percentage points."""
    return float(100 * abs(predicted.mean() - actual.mean()))


def peaks(hazard: Floats) -> list[int]:
    """The 3 highest-hazard bins among bins 2 to 100, at least 4 bins apart."""
    chosen: list[int] = []
    for index in sorted(range(1, len(hazard)), key=lambda i: (-hazard[i], i)):
        if all(abs(index - other) >= PEAK_GAP for other in chosen):
            chosen.append(index)
        if len(chosen) == PEAKS:
            break
    return chosen


def drop_hit_rate(predicted: Floats, actual: Floats) -> float:
    """Share of predicted peaks within 3 bins of an actual peak."""
    found = peaks(hazard_of(predicted))
    targets = peaks(hazard_of(actual))
    return sum(any(abs(f - t) <= PEAK_TOLERANCE for t in targets) for f in found) / len(found)


@dataclass(frozen=True)
class Scores:
    curve_mae_pp: float
    retention_error_pp: float
    drop_hit_rate: float


def score(predicted: Floats, actual: Floats) -> Scores:
    return Scores(
        curve_mae(predicted, actual),
        retention_error(predicted, actual),
        drop_hit_rate(predicted, actual),
    )


# Bands ---------------------------------------------------------------------


def _cholesky(cov: Floats) -> Floats:
    try:
        return cast(Floats, np.linalg.cholesky(cov))
    except np.linalg.LinAlgError:
        values, vectors = np.linalg.eigh(cov)
        return cast(Floats, vectors @ np.diag(np.sqrt(np.clip(values, 0.0, None))))


def sampled_curves(fit: Fit, x: Floats, normals: Floats, inflation: float = 1.0) -> Floats:
    """Survival curves (draws by bins) for coefficients drawn from the fit's covariance."""
    estimate = np.concatenate(([fit.alpha], fit.beta))
    thetas = estimate + math.sqrt(inflation) * normals @ _cholesky(fit.cov).T
    z = (x[:, fit.columns] - fit.mean) / fit.sd
    return survival(expit(thetas[:, :1] + thetas[:, 1:] @ z.T))


def band(curves: Floats) -> tuple[Floats, Floats, Floats]:
    low, middle, high = np.quantile(curves, [BAND[0], 0.5, BAND[1]], axis=0)
    return low, middle, high


def coverage(low: Floats, high: Floats, actual: Floats) -> float:
    """Share of bins 2 to 100 whose measured survival is inside the band."""
    return float(np.mean((actual[1:] >= low[1:]) & (actual[1:] <= high[1:])))


# A video to draw bands for: (fit, x, standard normals, measured survival).
Case = tuple[Fit, Floats, Floats, Floats]


def fit_inflation(cases: Sequence[Case]) -> float:
    """
    The covariance scale whose 80% bands cover 80% of the measured points on
    validation videos: (fit, x, normals, actual) per video. Coverage grows with
    the scale, so a bisection on its logarithm finds it.
    """

    low, high = math.log(1e-3), math.log(1e6)
    for _ in range(40):
        middle = (low + high) / 2
        if _covered(cases, math.exp(middle)) < 0.8:
            low = middle
        else:
            high = middle
    return math.exp(high)


# Rows ----------------------------------------------------------------------


@dataclass(frozen=True)
class Rows:
    x: Floats
    h: Floats
    w: Floats
    videos: list[str]


def select(
    table: TrainingTable, audience: str, videos: Sequence[str], columns: Sequence[str]
) -> Rows:
    """The audience's rows of `videos`, in video and bin order, with the model's weights."""
    wanted = set(videos)
    order = sorted(
        (
            i
            for i, (a, v) in enumerate(zip(table.audience, table.video, strict=True))
            if a == audience and v in wanted
        ),
        key=lambda i: (table.video[i], int(table.bin[i])),
    )
    rows = np.asarray(order, dtype=np.int64)
    labels = [table.video[i] for i in order]
    index = [table.names.index(name) for name in columns]
    return Rows(
        x=table.x[np.ix_(rows, index)] if order else np.zeros((0, len(index))),
        h=table.hazard[rows],
        w=video_weights(labels, table.n_at_risk[rows], table.video_views[rows]),
        videos=labels,
    )


def _fit(
    rows: Rows, columns: Sequence[str], config: ModelConfig, prior: Mapping[str, float] | None
) -> Fit:
    """Lambda by cross-validation on these rows' videos, then the fit."""
    cv = cross_validate(
        rows.x,
        columns,
        rows.h,
        rows.w,
        rows.videos,
        config.lambdas,
        config.folds,
        config.unpenalized,
        prior,
    )
    return fit_model(rows.x, columns, rows.h, rows.w, cv.chosen, config.unpenalized, prior)


def pooled_prior(
    pooled: TrainingTable | None,
    audience: str,
    columns: Sequence[str],
    exclude: set[str],
    config: ModelConfig,
) -> dict[str, float] | None:
    """The pooled model refitted without the test videos, as a prior; None below 2 channels."""
    if pooled is None:
        return None
    kept = sorted(
        {v for v, a in zip(pooled.video, pooled.audience, strict=True) if a == audience} - exclude
    )
    channel_of = dict(zip(pooled.video, pooled.channel, strict=True))
    if len({channel_of[v] for v in kept}) < MIN_POOLED_CHANNELS:
        return None
    rows = select(pooled, audience, kept, columns)
    fit = fit_model(rows.x, columns, rows.h, rows.w, config.pooled_lambda, config.unpenalized)
    return fit.raw_coefficients() if fit.converged else None


# Evaluation ----------------------------------------------------------------

Contender = Literal["model", "b0", "b1", "b2"]


@dataclass
class VideoResult:
    video_id: str
    duration_s: float
    scores: dict[str, Scores]  # model, b0_channel, b0_length, b1 (if any), b2
    actual_avg_pp: float
    predicted_avg_pp: dict[str, float]  # by contender, as `scores`
    coverage: float  # of the model's 80% band
    youtube_avp: float | None  # reference only
    curves: dict[str, Floats] = field(repr=False)  # for the plots


@dataclass
class AudienceResult:
    audience: str
    videos: list[VideoResult]
    lambdas: list[float]  # per fold
    not_converged: list[str]  # test videos skipped because their fold's model did not converge
    b0_variant: str = "channel average"
    summary: dict[str, dict[str, float | None]] = field(default_factory=dict)
    coverage: float | None = None
    inflation: dict[str, float] | None = None
    bootstrap: dict[str, float | bool] | None = None

    @property
    def b0_key(self) -> str:
        """The scores key of the stronger B0 variant."""
        return "b0_channel" if self.b0_variant == "channel average" else "b0_length"


@dataclass
class Evaluation:
    channel_id: str
    model_version: str
    feature_version: str
    mode: Mode
    reason: str | None
    as_of: str
    folds: list[Fold]
    too_new: list[str]
    audiences: dict[str, AudienceResult]


def _baseline_curves(
    table: TrainingTable,
    audience: str,
    train: Sequence[str],
    durations: Mapping[str, float],
    test_duration: float,
) -> tuple[Floats, Floats]:
    """B0: the mean training curve, and the mean of the 10 training videos nearest in length."""
    curves = {v: survival(select(table, audience, [v], []).h) for v in train}
    curves = {v: c for v, c in curves.items() if len(c) == 100}
    channel = np.mean(list(curves.values()), axis=0)
    nearest = sorted(curves, key=lambda v: (abs(durations[v] - test_duration), v))[:B0_NEIGHBOURS]
    return channel, np.mean([curves[v] for v in nearest], axis=0)


def _evaluate_audience(
    table: TrainingTable,
    audience: str,
    split: Split,
    config: ModelConfig,
    durations: Mapping[str, float],
    pooled: TrainingTable | None,
    llm_curves: Mapping[str, Floats],
    view_percentages: Mapping[tuple[str, str], float],
    rng: np.random.Generator,
) -> AudienceResult:
    columns = config.columns[audience]
    positions = [c for c in columns if table.kinds[table.names.index(c)] in POSITION_KINDS]
    result = AudienceResult(audience=audience, videos=[], lambdas=[], not_converged=[])
    validation: list[Case] = []
    tested: list[Case] = []  # aligned with result.videos

    for fold in split.folds:
        prior = pooled_prior(pooled, audience, columns, set(fold.test), config)
        train = select(table, audience, fold.train, columns)
        if not train.videos:
            result.not_converged.extend(fold.test)
            continue
        model = _fit(train, columns, config, prior)
        ablation = _fit(select(table, audience, fold.train, positions), positions, config, None)
        result.lambdas.append(model.lam)
        if not model.converged:
            result.not_converged.extend(fold.test)
            continue
        if split.mode == "holdout":
            validation = _validation_cases(table, audience, fold.train, columns, config, prior, rng)

        for video in fold.test:
            rows = select(table, audience, [video], columns)
            if len(rows.h) != 100:
                continue
            actual = survival(rows.h)
            predicted = survival(model.predict(rows.x))
            normals = rng.standard_normal((DRAWS, len(model.beta) + 1))
            low, middle, high = band(sampled_curves(model, rows.x, normals))
            tested.append((model, rows.x, normals, actual))
            b0_channel, b0_length = _baseline_curves(
                table, audience, fold.train, durations, durations[video]
            )
            contenders: dict[str, Floats] = {
                "model": predicted,
                "b0_channel": b0_channel,
                "b0_length": b0_length,
                "b2": survival(ablation.predict(select(table, audience, [video], positions).x)),
            }
            if video in llm_curves:
                contenders["b1"] = llm_curves[video]
            result.videos.append(
                VideoResult(
                    video_id=video,
                    duration_s=durations[video],
                    scores={name: score(curve, actual) for name, curve in contenders.items()},
                    actual_avg_pp=float(100 * actual.mean()),
                    predicted_avg_pp={
                        name: float(100 * c.mean()) for name, c in contenders.items()
                    },
                    coverage=coverage(low, high, actual),
                    youtube_avp=view_percentages.get((video, audience)),
                    curves={
                        "actual": actual,
                        "low": low,
                        "median": middle,
                        "high": high,
                        **contenders,
                    },
                )
            )

    if not result.videos:
        return result
    _summarize(result)
    result.coverage = float(np.mean([v.coverage for v in result.videos]))
    if validation:
        _inflate(result, validation, tested)
    b0 = result.b0_key
    result.bootstrap = paired_bootstrap(
        [v.scores["model"].curve_mae_pp - v.scores[b0].curve_mae_pp for v in result.videos],
        rng,
    )
    return result


def _validation_cases(
    table: TrainingTable,
    audience: str,
    train: Sequence[str],
    columns: Sequence[str],
    config: ModelConfig,
    prior: Mapping[str, float] | None,
    rng: np.random.Generator,
) -> list[Case]:
    """The newest 20% of the training videos, predicted by a model fitted on the rest."""
    held = max(2, math.ceil(VALIDATION_SHARE * len(train)))
    fitted, validation = list(train[:-held]), list(train[-held:])
    fit = _fit(select(table, audience, fitted, columns), columns, config, prior)
    if not fit.converged:
        return []
    cases: list[Case] = []
    for video in validation:
        rows = select(table, audience, [video], columns)
        if len(rows.h) == 100:
            normals = rng.standard_normal((DRAWS, len(fit.beta) + 1))
            cases.append((fit, rows.x, normals, survival(rows.h)))
    return cases


def _covered(cases: Sequence[Case], inflation: float = 1.0) -> float:
    return float(
        np.mean(
            [coverage(*band(sampled_curves(f, x, n, inflation))[::2], a) for f, x, n, a in cases]
        )
    )


def _inflate(result: AudienceResult, validation: list[Case], tested: list[Case]) -> None:
    """
    In holdout mode, when the validation videos' coverage misses 70 to 90%,
    one covariance factor is fitted on them and the test bands are drawn again
    with it. The point predictions do not change; the raw bands are kept.
    """
    before = _covered(validation)
    if COVERAGE_TARGET[0] <= before <= COVERAGE_TARGET[1]:
        result.inflation = {"validation_coverage": before, "factor": 1.0}
        return
    factor = fit_inflation(validation)
    for video, (fit, x, normals, _actual) in zip(result.videos, tested, strict=True):
        low, middle, high = band(sampled_curves(fit, x, normals, factor))
        video.curves.update(raw_low=video.curves["low"], raw_high=video.curves["high"])
        video.curves.update(low=low, median=middle, high=high)
    result.inflation = {
        "validation_coverage": before,
        "factor": factor,
        "test_coverage": _covered(tested, factor),
    }


def paired_bootstrap(
    differences: Sequence[float], rng: np.random.Generator
) -> dict[str, float | bool] | None:
    """
    The mean difference (model minus B0, in MAE percentage points) with a 95%
    interval from 2,000 resamples of the test videos. The model beats B0 only
    if the whole interval is below zero. None with fewer than 2 videos.
    """
    values = np.asarray(differences, dtype=np.float64)
    if len(values) < 2:
        return None
    means = values[rng.integers(0, len(values), (RESAMPLES, len(values)))].mean(axis=1)
    low, high = np.quantile(means, [0.025, 0.975])
    return {
        "mean_difference_pp": float(values.mean()),
        "low": float(low),
        "high": float(high),
        "beats_b0": bool(high < 0),
        "resamples": RESAMPLES,
    }


def _summarize(result: AudienceResult) -> None:
    """Means of each contender's scores over the test videos, and its ranking of them."""
    names = {name for v in result.videos for name in v.scores}
    channel = np.mean([v.scores["b0_channel"].curve_mae_pp for v in result.videos])
    length = np.mean([v.scores["b0_length"].curve_mae_pp for v in result.videos])
    result.b0_variant = "channel average" if channel <= length else "length matched"
    actual = np.array([v.actual_avg_pp for v in result.videos])
    for name in sorted(names):
        scored = [v for v in result.videos if name in v.scores]
        predicted = np.array([v.predicted_avg_pp[name] for v in scored])
        result.summary[name] = {
            "videos": float(len(scored)),
            "curve_mae_pp": float(np.mean([v.scores[name].curve_mae_pp for v in scored])),
            "retention_error_pp": float(
                np.mean([v.scores[name].retention_error_pp for v in scored])
            ),
            "drop_hit_rate": float(np.mean([v.scores[name].drop_hit_rate for v in scored])),
            "ranking_spearman": spearman(
                predicted, actual[[result.videos.index(v) for v in scored]]
            )
            if len(scored) >= 3
            else None,
        }


def evaluate_channel(
    *,
    channel_id: str,
    table: TrainingTable,
    videos: Sequence[VideoInfo],
    as_of: date,
    config: ModelConfig,
    min_train_videos: int,
    pooled: TrainingTable | None = None,
    llm_curves: Mapping[str, Floats] | None = None,
    view_percentages: Mapping[tuple[str, str], float] | None = None,
    audiences: Sequence[str] = AUDIENCES,
    seed: int = SEED,
    progress: Callable[[int, int], None] | None = None,
) -> Evaluation:
    """
    Evaluates every audience of one channel; `table` holds that channel's rows.
    `progress` is called with (audiences done, audiences) after each.
    """
    present = set(table.video)
    usable = [v for v in videos if v.video_id in present]
    split = choose_split(usable, as_of, min_train_videos, config.evaluation)
    durations = {v.video_id: v.duration_s for v in usable}
    rng = np.random.default_rng(seed)
    results: dict[str, AudienceResult] = {}
    if progress is not None:
        progress(0, len(audiences))
    for audience in audiences:
        results[audience] = _evaluate_audience(
            table,
            audience,
            split,
            config,
            durations,
            pooled,
            llm_curves or {},
            view_percentages or {},
            rng,
        )
        if progress is not None:
            progress(len(results), len(audiences))
    return Evaluation(
        channel_id=channel_id,
        model_version=config.model_version,
        feature_version=config.feature_version,
        mode=split.mode,
        reason=split.reason,
        as_of=as_of.isoformat(),
        folds=split.folds,
        too_new=split.too_new,
        audiences=results,
    )

"""Command line entry point, run as a Cloud Run Job."""

from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated, Any

import typer

from soundcheck_modeling import eda as eda_module
from soundcheck_modeling.contract import ModelConfig, load_config
from soundcheck_modeling.data import AUDIENCES
from soundcheck_modeling.evaluation_run import EvaluationOutcome, Evaluator
from soundcheck_modeling.experiments import VertexExperiments
from soundcheck_modeling.model_card import DEFAULT_CARD, card_context, render_card
from soundcheck_modeling.progress import ProgressWriter, channel_progress
from soundcheck_modeling.settings import load_settings
from soundcheck_modeling.store import CloudStore
from soundcheck_modeling.train import Outcome, Trainer

app = typer.Typer(
    help="Fit and evaluate Soundcheck models. Reads features; never computes them.",
    no_args_is_help=True,
)


def make_trainer() -> Trainer:
    settings = load_settings()
    store = CloudStore(settings)
    return Trainer(
        source=store,
        store=store,
        experiments=VertexExperiments(settings.project, settings.region),
        config=load_config(),
        min_train_videos=settings.min_train_videos,
    )


# What the fit commands train with; tests replace it.
TRAINER: Callable[[], Trainer] = make_trainer

AudienceOption = Annotated[
    list[str] | None,
    typer.Option(
        "--audience",
        help="all, subscribed or unsubscribed; repeat for several (default: all three)",
    ),
]


def _audiences(chosen: list[str] | None) -> list[str]:
    unknown = [a for a in chosen or [] if a not in AUDIENCES]
    if unknown:
        raise typer.BadParameter(
            f"unknown audience {', '.join(unknown)}; use {', '.join(AUDIENCES)}"
        )
    return chosen or list(AUDIENCES)


def _report(scope: str, outcomes: list[Outcome]) -> None:
    for o in outcomes:
        line = f"{scope}, {o.audience}: {o.status.replace('_', ' ')}"
        if o.status == "fitted":
            usable = "usable" if o.usable else f"not usable ({'; '.join(o.reasons)})"
            line += f", {usable}, lambda {o.lam:g}, {o.rows} rows from {o.videos} videos"
            line += f" -> {o.artifact_uri}"
        elif o.status == "not_converged":
            line += f" at lambda {o.lam:g}; no model written"
        elif o.error:
            line += f": {o.error}"
        typer.echo(line)
    if any(o.status == "failed" for o in outcomes):
        raise typer.Exit(code=1)


@app.command("fit-pooled")
def fit_pooled(audience: AudienceOption = None) -> None:
    """Fit the pooled models across every channel, the prior for each channel's models."""
    _report("pooled", TRAINER().train_pooled(_audiences(audience)))


@app.command()
def fit(
    channel: Annotated[str, typer.Option(help="The channel to fit")],
    audience: AudienceOption = None,
) -> None:
    """Fit a channel's per-audience hazard models from the feature matrix."""
    _report(channel, TRAINER().train_channel(channel, _audiences(audience)))


@app.command()
def eda(
    feature_version: Annotated[
        str | None, typer.Option(help="Feature version to analyse; the newest by default")
    ] = None,
    channel: Annotated[str | None, typer.Option(help="Only this channel's rows")] = None,
    out: Annotated[Path, typer.Option(help="Folder for the report")] = eda_module.DEFAULT_OUT,
) -> None:
    """Summarize training_bins: rows, missing data, distributions, correlation with hazard."""
    table = eda_module.READER(load_settings(), feature_version, channel)
    folder, summary = eda_module.write_report(table, out)
    typer.echo(f"{summary.rows} rows of {summary.feature_version}: report in {folder}")
    for audience in AUDIENCES:
        top = eda_module.top_correlations(summary, audience, content=True, count=5)
        if top:
            ranked = ", ".join(f"{c.name} {c.spearman:+.2f}" for c in top if c.spearman is not None)
            typer.echo(f"  {audience}: {ranked}")


def make_evaluator() -> Evaluator:
    settings = load_settings()
    store = CloudStore(settings)
    return Evaluator(
        source=store,
        store=store,
        experiments=VertexExperiments(settings.project, settings.region),
        config=load_config(),
        min_train_videos=settings.min_train_videos,
    )


def latest_evaluations(config: ModelConfig) -> list[dict[str, Any]]:
    return CloudStore(load_settings()).latest_evaluations(
        config.model_version, config.feature_version
    )


# What the evaluation commands run with; tests replace them.
EVALUATOR: Callable[[], Evaluator] = make_evaluator
EVALUATIONS: Callable[[ModelConfig], list[dict[str, Any]]] = latest_evaluations
CONFIG: Callable[[], ModelConfig] = load_config


def _pp(value: Any) -> str:
    return "n/a" if value is None else f"{float(value):.1f}"


@app.command()
def evaluate(
    channel: Annotated[str, typer.Option(help="The channel to evaluate")],
    audience: AudienceOption = None,
) -> None:
    """Evaluate a channel's model on held-out videos against the baselines (Phase 09)."""
    _report_evaluation(channel, EVALUATOR().run(channel, _audiences(audience)))


def _report_evaluation(channel: str, outcome: EvaluationOutcome) -> None:
    if outcome.status == "failed":
        typer.echo(f"{channel}: evaluation failed: {outcome.error}")
        raise typer.Exit(code=1)
    details = outcome.details
    mode = "held out" if outcome.status == "holdout" else f"check mode ({details['reason']})"
    typer.echo(f"{channel}: {mode}, data through {details['as_of']}")
    for name, result in details["audiences"].items():
        summary = result["summary"]
        if not summary:
            typer.echo(f"  {name}: no test video could be scored")
            continue
        b0 = "b0_channel" if result["b0_variant"] == "channel average" else "b0_length"
        line = (
            f"  {name}: curve error model {_pp(summary['model']['curve_mae_pp'])} pp, "
            f"B0 {_pp(summary[b0]['curve_mae_pp'])} ({result['b0_variant']}), "
            f"B1 {_pp(summary.get('b1', {}).get('curve_mae_pp'))}, "
            f"B2 {_pp(summary['b2']['curve_mae_pp'])}"
        )
        bootstrap = result["bootstrap"]
        if bootstrap:
            line += (
                f"; model minus B0 {float(bootstrap['mean_difference_pp']):+.1f} "
                f"({float(bootstrap['low']):+.1f} to {float(bootstrap['high']):+.1f})"
            )
        line += f"; 80% band covers {100 * float(result['coverage']):.0f}%"
        typer.echo(line)
    folder = outcome.plots[0].parent if outcome.plots else None
    typer.echo(f"  plots: {len(outcome.plots)} in {folder}" if folder else "  plots: none")
    typer.echo(f"  eval_runs: run {outcome.run_id[:8]} ({outcome.status})")


@app.command("model-card")
def model_card(
    out: Annotated[Path, typer.Option(help="Where to write the card")] = DEFAULT_CARD,
) -> None:
    """Write docs/model-card.md from each channel's latest evaluation."""
    config = CONFIG()
    evaluations = EVALUATIONS(config)
    context = card_context(
        evaluations,
        model_version=config.model_version,
        feature_version=config.feature_version,
        generated=datetime.now(UTC),
    )
    out.write_text(render_card(context))
    typer.echo(f"wrote {out} from {len(evaluations)} channel evaluation(s)")


STAGES = ("train", "train-pooled", "evaluate")


def make_progress(stage: str, channel: str) -> ProgressWriter:
    settings = load_settings()
    return channel_progress(settings.project, settings.firestore_database, channel, stage)


# The build-progress writer the stages use; tests replace it.
PROGRESS: Callable[[str, str], ProgressWriter] = make_progress


@app.command()
def stage(
    name: Annotated[str, typer.Argument(help="train | train-pooled | evaluate")],
    channel: Annotated[
        str | None, typer.Option(help="The channel (default: the job's CHANNEL_ID)")
    ] = None,
) -> None:
    """Run one stage of the channel build, as its Cloud Run job does (Phase 10)."""
    if name not in STAGES:
        raise typer.BadParameter(f"expected one of {', '.join(STAGES)}", param_hint="STAGE")
    if name == "train-pooled":
        # Across every channel; the weekly refresh runs it once before the channels.
        _report("pooled", TRAINER().train_pooled(list(AUDIENCES)))
        return
    target = channel or load_settings().channel_id
    if not target:
        raise typer.BadParameter("pass --channel or set CHANNEL_ID", param_hint="--channel")
    writer = PROGRESS(name, target)
    try:
        if name == "train":
            trainer = TRAINER()
            trainer.progress = writer.update
            outcomes = trainer.train_channel(target, list(AUDIENCES))
        else:
            evaluator = EVALUATOR()
            evaluator.plots_dir = None
            evaluator.progress = writer.update
            evaluation = evaluator.run(target)
    finally:
        writer.flush()
    if name == "train":
        _report(target, outcomes)
    else:
        _report_evaluation(target, evaluation)

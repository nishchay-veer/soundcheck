"""Command line entry point, run as a Cloud Run Job."""

from collections.abc import Callable
from pathlib import Path
from typing import Annotated

import typer

from soundcheck_modeling import eda as eda_module
from soundcheck_modeling.contract import load_config
from soundcheck_modeling.data import AUDIENCES
from soundcheck_modeling.experiments import VertexExperiments
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
def evaluate() -> None:
    """Evaluate fitted models on held-out videos against the baselines."""
    typer.echo("evaluate: not implemented")


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

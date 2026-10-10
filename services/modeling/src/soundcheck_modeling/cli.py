"""Command line entry point, run as a Cloud Run Job."""

from pathlib import Path
from typing import Annotated

import typer

from soundcheck_modeling import eda as eda_module
from soundcheck_modeling.settings import load_settings

app = typer.Typer(
    help="Fit and evaluate Soundcheck models. Reads features; never computes them.",
    no_args_is_help=True,
)


@app.command()
def fit() -> None:
    """Fit the per-audience hazard models from the feature matrix."""
    typer.echo("fit: not implemented")


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
    for audience in eda_module.AUDIENCES:
        top = eda_module.top_correlations(summary, audience, content=True, count=5)
        if top:
            ranked = ", ".join(f"{c.name} {c.spearman:+.2f}" for c in top if c.spearman is not None)
            typer.echo(f"  {audience}: {ranked}")

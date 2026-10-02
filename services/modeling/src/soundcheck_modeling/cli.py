"""Command line entry point, run as a Cloud Run Job."""

import typer

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

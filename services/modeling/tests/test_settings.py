import shutil
import subprocess
import sys
from pathlib import Path

import pytest

import soundcheck_modeling
from soundcheck_modeling.settings import REPO_ROOT, Settings, find_repo_root, load_settings


def test_settings_need_a_project_and_default_the_rest() -> None:
    assert load_settings({"GCP_PROJECT_ID": "proj"}) == Settings(
        project="proj",
        dataset="soundcheck",
        location="US",
        region="us-central1",
        raw_bucket="proj-raw",
        min_train_videos=20,
    )
    assert load_settings(
        {
            "GCP_PROJECT_ID": "proj",
            "BQ_DATASET": "other",
            "BQ_LOCATION": "EU",
            "GCP_REGION": "europe-west1",
            "GCS_RAW_BUCKET": "bucket",
            "MIN_TRAIN_VIDEOS": "40",
        }
    ) == Settings("proj", "other", "EU", "europe-west1", "bucket", 40)
    with pytest.raises(RuntimeError, match="GCP_PROJECT_ID is not set"):
        load_settings({"GCP_PROJECT_ID": " "})
    job = load_settings(
        {"GCP_PROJECT_ID": "proj", "CHANNEL_ID": "UCx", "RUN_ID": "run-1", "BUILD_MODE": "refresh"}
    )
    assert (job.channel_id, job.run_id, job.build_mode) == ("UCx", "run-1", "refresh")
    with pytest.raises(RuntimeError, match="BUILD_MODE must be build or refresh"):
        load_settings({"GCP_PROJECT_ID": "proj", "BUILD_MODE": "weekly"})
    with pytest.raises(RuntimeError, match="MIN_TRAIN_VIDEOS must be a whole number"):
        load_settings({"GCP_PROJECT_ID": "proj", "MIN_TRAIN_VIDEOS": "many"})


def test_table_names_are_quoted_for_sql_and_plain_for_load_jobs() -> None:
    settings = Settings("proj", "ds", "US")
    assert settings.table("training_bins") == "`proj.ds.training_bins`"
    assert settings.table_id("model_runs") == "proj.ds.model_runs"


def test_the_repo_root_is_found_in_a_checkout_and_falls_back_outside_one(tmp_path: Path) -> None:
    assert (REPO_ROOT / "pnpm-workspace.yaml").is_file()
    (tmp_path / "repo" / "a" / "b").mkdir(parents=True)
    (tmp_path / "repo" / "pnpm-workspace.yaml").write_text("")
    assert find_repo_root(tmp_path / "repo" / "a" / "b" / "x.py") == tmp_path / "repo"
    assert find_repo_root(Path("/x.py")) == Path.cwd()


def test_the_cli_imports_from_the_container_layout(tmp_path: Path) -> None:
    # The image has the package at /app/src/soundcheck_modeling with no repo
    # around it. Paths counted up from the repo layout at import time pointed
    # outside it, and past / there, which crashed every modeling job.
    package = Path(soundcheck_modeling.__file__).parent
    shutil.copytree(package, tmp_path / "src" / "soundcheck_modeling")
    script = (
        "import soundcheck_modeling.cli\n"
        "from soundcheck_modeling import eda, evaluation_run, model_card\n"
        "print(eda.DEFAULT_OUT, evaluation_run.DEFAULT_PLOTS, model_card.DEFAULT_CARD, sep='\\n')"
    )
    result = subprocess.run(
        [sys.executable, "-c", script],
        cwd=tmp_path,
        env={"PYTHONPATH": str(tmp_path / "src"), "MPLBACKEND": "Agg"},
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    defaults = [Path(line) for line in result.stdout.splitlines()]
    assert len(defaults) == 3
    assert all(path.is_relative_to(tmp_path.resolve() / "docs") for path in defaults), defaults

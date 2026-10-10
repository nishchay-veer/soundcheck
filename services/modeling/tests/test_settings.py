import pytest

from soundcheck_modeling.settings import Settings, load_settings


def test_settings_need_a_project_and_default_the_rest() -> None:
    assert load_settings({"GCP_PROJECT_ID": "proj"}) == Settings(
        project="proj",
        dataset="soundcheck",
        location="US",
        region="us-central1",
        raw_bucket="proj-raw",
        min_train_videos=30,
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

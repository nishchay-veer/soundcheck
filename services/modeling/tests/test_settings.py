import pytest

from soundcheck_modeling.settings import Settings, load_settings


def test_settings_need_a_project_and_default_the_rest() -> None:
    assert load_settings({"GCP_PROJECT_ID": "proj"}) == Settings("proj", "soundcheck", "US")
    assert load_settings(
        {"GCP_PROJECT_ID": "proj", "BQ_DATASET": "other", "BQ_LOCATION": "EU"}
    ) == Settings("proj", "other", "EU")
    with pytest.raises(RuntimeError, match="GCP_PROJECT_ID is not set"):
        load_settings({"GCP_PROJECT_ID": " "})


def test_table_names_are_quoted_for_sql() -> None:
    assert Settings("proj", "ds", "US").table("training_bins") == "`proj.ds.training_bins`"

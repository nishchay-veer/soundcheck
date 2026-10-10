from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from synthetic import AS_OF, CONFIG, channel
from typer.testing import CliRunner

from soundcheck_modeling import cli
from soundcheck_modeling.evaluate import evaluate_channel
from soundcheck_modeling.evaluation_run import evaluation_details
from soundcheck_modeling.model_card import card_context, render_card

GENERATED = datetime(2026, 10, 10, 12, 0, tzinfo=UTC)


def details(videos: int, name: str, audiences: list[str] | None = None) -> dict[str, Any]:
    table, infos = channel(videos, name=name)
    evaluation = evaluate_channel(
        channel_id=name,
        table=table,
        videos=infos,
        as_of=AS_OF,
        config=CONFIG,
        min_train_videos=30,
        audiences=audiences or ["all"],
    )
    return {**evaluation_details(evaluation), "min_train_videos": 30}


def card(evaluations: list[dict[str, Any]]) -> str:
    return render_card(
        card_context(
            evaluations, model_version="hazard-v2", feature_version="feat-x", generated=GENERATED
        )
    )


def test_a_card_from_check_mode_says_there_is_no_result_yet() -> None:
    text = card([details(3, "UCaaaaaaaaaaaaaaaaaaaaaa")])
    assert text.startswith("# Soundcheck model card")
    assert "Model `hazard-v2` on features `feat-x` · generated 2026-10-10" in text
    assert "> **No result yet.** No channel has enough videos to hold some out" in text
    assert "6 test videos and 30 training videos" in text
    assert "| `UCaaaaaaaaaaaaaaaaaaaaaa` | check: each video held out in turn | 3 | 2 |" in text
    assert "### `UCaaaaaaaaaaaaaaaaaaaaaa` (check mode: not a result)" in text
    assert "no claim (check mode)" in text and "beats the channel average" not in text
    assert "not checked (check mode)" in text
    assert "## Limitations" in text and "Aug 27, 2026" in text


def test_a_card_from_a_held_out_test_states_the_verdict_and_calibration() -> None:
    text = card([details(45, "UCbbbbbbbbbbbbbbbbbbbbbb")])
    assert "No result yet" not in text
    assert "| `UCbbbbbbbbbbbbbbbbbbbbbb` | held out (newest 20%) | 9 | 36 |" in text
    assert "beats the channel average" in text
    assert "fitted on validation videos" in text or "none needed" in text
    row = next(line for line in text.splitlines() if line.startswith("| All viewers | 9 |"))
    cells = [cell.strip() for cell in row.split("|")]
    # | Audience | Test videos | Model | B0 (variant) | ...
    assert float(cells[3]) < float(cells[4].split()[0])


def test_a_card_without_evaluations_asks_for_one() -> None:
    assert "> **No evaluation yet.**" in card([])


def test_the_model_card_command_writes_the_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(cli, "CONFIG", lambda: CONFIG)
    monkeypatch.setattr(cli, "EVALUATIONS", lambda config: [details(3, "UCaaaaaaaaaaaaaaaaaaaaaa")])
    out = tmp_path / "model-card.md"
    result = CliRunner().invoke(cli.app, ["model-card", "--out", str(out)])
    assert result.exit_code == 0, result.output
    assert result.output == f"wrote {out} from 1 channel evaluation(s)\n"
    assert "No result yet" in out.read_text()

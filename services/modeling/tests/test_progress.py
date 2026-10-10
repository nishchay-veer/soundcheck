from typing import Any

import pytest

from soundcheck_modeling.progress import ProgressWriter


class Document:
    def __init__(self, fail: bool = False) -> None:
        self.writes: list[dict[str, Any]] = []
        self.fail = fail

    def update(self, field_updates: dict[str, Any]) -> None:
        if self.fail:
            raise RuntimeError("14 UNAVAILABLE")
        self.writes.append(field_updates["build.progress"])


class Clock:
    def __init__(self) -> None:
        self.now = 100.0

    def __call__(self) -> float:
        return self.now


def test_writes_at_most_every_5_seconds_with_an_eta() -> None:
    document, clock = Document(), Clock()
    writer = ProgressWriter(document, "train", clock=clock)
    writer.update(0, 3)  # written at once, with no ETA yet
    clock.now += 2
    writer.update(1, 3)  # held: only 2 s since the last write
    clock.now += 4
    writer.update(2, 3)  # 6 s since the last write: written, 2 done in 6 s
    assert [(w["done"], w["total"]) for w in document.writes] == [(0, 3), (2, 3)]
    assert "etaS" not in document.writes[0]
    assert document.writes[1]["etaS"] == 3
    assert document.writes[1]["stage"] == "train"


def test_flush_writes_the_latest_value_once() -> None:
    document, clock = Document(), Clock()
    writer = ProgressWriter(document, "evaluate", clock=clock)
    writer.update(1, 3)
    writer.update(3, 3)
    writer.flush()
    writer.flush()
    assert [(w["done"], w["total"]) for w in document.writes] == [(1, 3), (3, 3)]


def test_a_failed_write_is_logged_not_raised(caplog: pytest.LogCaptureFixture) -> None:
    writer = ProgressWriter(Document(fail=True), "train", clock=Clock())
    writer.update(1, 3)
    writer.flush()
    assert "build progress write failed for train" in caplog.text

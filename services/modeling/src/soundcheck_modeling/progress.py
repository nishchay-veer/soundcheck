"""Build progress for the Python stages (Phase 10): the equivalent of
`progressWriter` in packages/core. It writes `channels/{id}.build.progress` as
{stage, done, total, etaS, updatedAt}, at most once every 5 seconds. Progress
is best effort: a failed write is logged and never fails the job.
"""

import logging
import time
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any, Protocol

INTERVAL_S = 5.0
# The time left is only estimated once this many items are done (as `ETA_MIN_DONE`
# in packages/core): one finished item says little about the pace of the rest.
ETA_MIN_DONE = 2
log = logging.getLogger(__name__)


class Document(Protocol):
    def update(self, field_updates: dict[str, Any]) -> Any: ...


class ProgressWriter:
    def __init__(
        self,
        document: Document,
        stage: str,
        clock: Callable[[], float] = time.monotonic,
        interval_s: float = INTERVAL_S,
    ) -> None:
        self.document = document
        self.stage = stage
        self.clock = clock
        self.interval_s = interval_s
        self.started = clock()
        self.last_write = float("-inf")
        self.pending: tuple[int, int] | None = None

    def update(self, done: int, total: int) -> None:
        """Records progress; written now if the last write is older than the interval."""
        self.pending = (done, total)
        if self.clock() - self.last_write >= self.interval_s:
            self._write()

    def flush(self) -> None:
        """Writes any pending value now."""
        self._write()

    def _write(self) -> None:
        if self.pending is None:
            return
        done, total = self.pending
        self.pending = None
        self.last_write = now = self.clock()
        progress: dict[str, Any] = {
            "stage": self.stage,
            "done": done,
            "total": total,
            "updatedAt": datetime.now(UTC),
        }
        if done >= ETA_MIN_DONE:
            progress["etaS"] = round((now - self.started) / done * (total - done))
        try:
            self.document.update({"build.progress": progress})
        except Exception as error:  # progress must never fail the job
            log.warning("build progress write failed for %s: %s", self.stage, error)


def channel_progress(project: str, database: str, channel_id: str, stage: str) -> ProgressWriter:
    """A writer for the channel's build document in Firestore."""
    from google.cloud import firestore

    client = firestore.Client(project=project, database=database)
    return ProgressWriter(client.collection("channels").document(channel_id), stage)

import socket

import pytest
from pytest_socket import SocketBlockedError
from typer.testing import CliRunner

from soundcheck_modeling.cli import app

runner = CliRunner()


def test_every_command_is_listed() -> None:
    result = runner.invoke(app, ["--help"])
    for command in ("fit", "fit-pooled", "evaluate", "model-card", "eda"):
        assert command in result.output


@pytest.mark.filterwarnings("ignore:A test tried to use socket.socket")
def test_unit_tests_cannot_open_sockets() -> None:
    with pytest.raises(SocketBlockedError):
        socket.socket(socket.AF_INET, socket.SOCK_STREAM)

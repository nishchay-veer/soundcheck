import socket

import pytest
from pytest_socket import SocketBlockedError
from typer.testing import CliRunner

from soundcheck_modeling.cli import app

runner = CliRunner()


@pytest.mark.parametrize("command", ["fit", "evaluate"])
def test_stub_commands_print_not_implemented(command: str) -> None:
    result = runner.invoke(app, [command])
    assert result.exit_code == 0
    assert result.output == f"{command}: not implemented\n"


@pytest.mark.filterwarnings("ignore:A test tried to use socket.socket")
def test_unit_tests_cannot_open_sockets() -> None:
    with pytest.raises(SocketBlockedError):
        socket.socket(socket.AF_INET, socket.SOCK_STREAM)

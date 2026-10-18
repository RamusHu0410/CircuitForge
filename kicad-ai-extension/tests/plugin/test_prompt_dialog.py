"""Dialog smoke tests with a real Tk window. Skipped when Tk or a display is unavailable."""

import threading
import time
from pathlib import Path

import pytest

tk = pytest.importorskip("tkinter")

from actions.generate_schematic import Outcome  # noqa: E402
from ui.prompt_dialog import PromptDialog  # noqa: E402

OK = Outcome(True, "Generated 'X'", "Saved to /tmp/x.kicad_sch", schematic_path=Path("/tmp/x.kicad_sch"))


@pytest.fixture
def root():
    try:
        window = tk.Tk()
    except tk.TclError as exc:
        pytest.skip(f"no display: {exc}")
    # Keep the window mapped but off-screen. Withdrawn windows trigger a macOS Tk bug
    # where geometry updates loop forever; real dialogs are always shown, so they don't.
    window.geometry("+4000+4000")
    yield window
    try:
        window.destroy()
    except tk.TclError:
        pass  # already destroyed by cancel()


def pump_until(root, condition, timeout_s: float = 3.0) -> None:
    deadline = time.monotonic() + timeout_s
    while not condition():
        if time.monotonic() > deadline:
            raise AssertionError("condition not met in time")
        root.update()
        time.sleep(0.01)


def state(button) -> str:
    return str(button.cget("state"))


def test_has_prompt_field_and_buttons(root) -> None:
    dialog = PromptDialog(root, lambda _p: OK)
    assert dialog.generate_button.cget("text") == "Generate"
    assert dialog.cancel_button.cget("text") == "Close"
    assert state(dialog.open_button) == "disabled"
    dialog.text.insert("1.0", "line one\nline two")
    assert dialog.prompt_text() == "line one\nline two"


def test_empty_prompt_shows_error_without_submitting(root) -> None:
    calls = []
    dialog = PromptDialog(root, lambda p: calls.append(p) or OK)
    dialog.generate()

    assert calls == []
    assert dialog.last_outcome and not dialog.last_outcome.ok
    assert "Describe the circuit" in dialog.result_text()


def test_loading_state_then_success_enables_file_buttons(root) -> None:
    release = threading.Event()
    opened = []

    def submit(prompt: str) -> Outcome:
        release.wait(2)
        return OK

    dialog = PromptDialog(root, submit, on_open=lambda p: opened.append(p), on_reveal=lambda p: None)
    dialog.text.insert("1.0", "LED circuit")
    dialog.generate()

    root.update()
    assert dialog.busy
    assert state(dialog.generate_button) == "disabled"
    assert "Generating" in dialog.status.cget("text")

    release.set()
    pump_until(root, lambda: not dialog.busy)
    assert state(dialog.generate_button) == "normal"
    assert dialog.status.cget("text") == "Generated 'X'"
    assert "Saved to" in dialog.result_text()
    assert state(dialog.open_button) == "normal" and state(dialog.reveal_button) == "normal"

    dialog.open_result()
    assert opened == [Path("/tmp/x.kicad_sch")]


def test_open_error_is_shown(root) -> None:
    dialog = PromptDialog(root, lambda _p: OK, on_open=lambda p: "Could not open the schematic: nope")
    dialog.text.insert("1.0", "LED")
    dialog.generate()
    pump_until(root, lambda: not dialog.busy)
    dialog.open_result()
    assert "Could not open" in dialog.status.cget("text")


def test_error_outcome_and_raising_submit(root) -> None:
    def submit(_prompt: str) -> Outcome:
        raise RuntimeError("worker blew up")

    dialog = PromptDialog(root, submit, on_open=lambda p: None)
    dialog.text.insert("1.0", "LED")
    dialog.generate()
    pump_until(root, lambda: not dialog.busy)

    assert not dialog.last_outcome.ok
    assert "worker blew up" in dialog.result_text()
    assert state(dialog.open_button) == "disabled"


def test_cancel_closes(root) -> None:
    dialog = PromptDialog(root, lambda _p: OK)
    dialog.cancel()
    assert dialog.closed
    with pytest.raises(tk.TclError):
        root.winfo_exists()

"""Dialog smoke tests with a real Tk window. Skipped when Tk or a display is unavailable."""

import threading
import time

import pytest

tk = pytest.importorskip("tkinter")

from actions.generate_schematic import Outcome  # noqa: E402
from ui.prompt_dialog import PromptDialog  # noqa: E402


@pytest.fixture
def root():
    try:
        window = tk.Tk()
    except tk.TclError as exc:
        pytest.skip(f"no display: {exc}")
    window.withdraw()
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


def test_has_prompt_field_and_buttons(root) -> None:
    dialog = PromptDialog(root, lambda _p: Outcome(True, "ok", "ok"))
    assert dialog.generate_button.cget("text") == "Generate"
    assert dialog.cancel_button.cget("text") == "Cancel"
    dialog.text.insert("1.0", "line one\nline two")
    assert dialog.prompt_text() == "line one\nline two"


def test_empty_prompt_shows_error_without_submitting(root) -> None:
    calls = []
    dialog = PromptDialog(root, lambda p: calls.append(p) or Outcome(True, "ok", "ok"))
    dialog.generate()

    assert calls == []
    assert dialog.last_outcome and not dialog.last_outcome.ok
    assert "Describe the circuit" in dialog.status.cget("text")


def test_loading_state_then_success(root) -> None:
    release = threading.Event()

    def submit(prompt: str) -> Outcome:
        release.wait(2)
        return Outcome(True, "Prompt received", f"got {prompt}")

    dialog = PromptDialog(root, submit)
    dialog.text.insert("1.0", "LED circuit")
    dialog.generate()

    root.update()
    assert dialog.busy
    assert str(dialog.generate_button.cget("state")) == "disabled"
    assert "Contacting the backend" in dialog.status.cget("text")

    release.set()
    pump_until(root, lambda: not dialog.busy)
    assert str(dialog.generate_button.cget("state")) == "normal"
    assert dialog.status.cget("text") == "Prompt received: got LED circuit"


def test_error_outcome_and_raising_submit(root) -> None:
    def submit(_prompt: str) -> Outcome:
        raise RuntimeError("worker blew up")

    dialog = PromptDialog(root, submit)
    dialog.text.insert("1.0", "LED")
    dialog.generate()
    pump_until(root, lambda: not dialog.busy)

    assert not dialog.last_outcome.ok
    assert "worker blew up" in dialog.status.cget("text")


def test_cancel_closes(root) -> None:
    dialog = PromptDialog(root, lambda _p: Outcome(True, "ok", "ok"))
    dialog.cancel()
    assert dialog.closed
    with pytest.raises(tk.TclError):
        root.winfo_exists()

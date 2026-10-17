"""Prompt dialog (Tkinter).

Tkinter ships with the Python standard library, so the dialog needs no extra
dependencies. KiCad 11 no longer bundles Python or wxPython, so a wx-based UI
would require users to install wxPython themselves.

The backend call runs on a worker thread; results are handed back to the Tk
thread through a queue polled with `after`, because Tk widgets must only be
touched from the thread that created them.
"""

from __future__ import annotations

import queue
import threading
import tkinter as tk
from collections.abc import Callable
from tkinter import ttk
from tkinter.scrolledtext import ScrolledText

from actions.generate_schematic import MAX_PROMPT_LENGTH, Outcome, validate_prompt

PLACEHOLDER_EXAMPLE = "Example: a 5 V LED indicator with a current-limiting resistor and a power connector."
_POLL_MS = 50

SubmitFn = Callable[[str], Outcome]


class PromptDialog:
    def __init__(self, root: tk.Tk, on_submit: SubmitFn, status_text: str = "") -> None:
        self.root = root
        self.on_submit = on_submit
        self.busy = False
        self.closed = False
        self.last_outcome: Outcome | None = None
        self._results: queue.Queue[Outcome] = queue.Queue()

        root.title("AI Schematic Generator")
        root.minsize(480, 360)
        root.protocol("WM_DELETE_WINDOW", self.cancel)

        frame = ttk.Frame(root, padding=12)
        frame.grid(sticky="nsew")
        root.columnconfigure(0, weight=1)
        root.rowconfigure(0, weight=1)
        frame.columnconfigure(0, weight=1)
        frame.rowconfigure(2, weight=1)

        ttk.Label(frame, text="Describe the circuit you want to generate:").grid(row=0, column=0, sticky="w")
        ttk.Label(frame, text=PLACEHOLDER_EXAMPLE, foreground="gray", wraplength=460).grid(
            row=1, column=0, sticky="w", pady=(2, 6)
        )

        self.text = ScrolledText(frame, height=10, wrap="word", undo=True)
        self.text.grid(row=2, column=0, sticky="nsew")
        self.text.bind("<<Modified>>", self._on_text_modified)

        self.counter = ttk.Label(frame, text=f"0 / {MAX_PROMPT_LENGTH}", foreground="gray")
        self.counter.grid(row=3, column=0, sticky="e", pady=(2, 0))

        # Always laid out and only started/stopped: toggling it with grid()/grid_remove()
        # shifts the layout, and on macOS Tk can loop forever re-laying out a withdrawn window.
        self.progress = ttk.Progressbar(frame, mode="indeterminate")
        self.progress.grid(row=4, column=0, sticky="ew", pady=(8, 0))

        self.status = ttk.Label(frame, text=status_text, wraplength=460, justify="left")
        self.status.grid(row=5, column=0, sticky="w", pady=(8, 0))

        buttons = ttk.Frame(frame)
        buttons.grid(row=6, column=0, sticky="e", pady=(12, 0))
        self.cancel_button = ttk.Button(buttons, text="Cancel", command=self.cancel)
        self.cancel_button.grid(row=0, column=0, padx=(0, 8))
        self.generate_button = ttk.Button(buttons, text="Generate", command=self.generate, default="active")
        self.generate_button.grid(row=0, column=1)

        # Ctrl/Cmd+Enter generates (plain Enter inserts a newline); Escape cancels.
        for sequence in ("<Control-Return>", "<Command-Return>"):
            try:
                root.bind(sequence, lambda _event: self.generate())
            except tk.TclError:  # <Command-...> only exists on macOS
                pass
        root.bind("<Escape>", lambda _event: self.cancel())

        self.text.focus_set()

    # --- Actions ------------------------------------------------------------

    def prompt_text(self) -> str:
        return self.text.get("1.0", "end-1c")

    def generate(self) -> None:
        if self.busy or self.closed:
            return
        prompt = self.prompt_text()
        error = validate_prompt(prompt)
        if error:
            self._show(Outcome(ok=False, title="Check your description", message=error))
            return

        self._set_busy(True)
        threading.Thread(target=self._worker, args=(prompt,), daemon=True).start()
        self.root.after(_POLL_MS, self._poll)

    def cancel(self) -> None:
        # Closing while a request is in flight is allowed; the daemon worker's
        # result is discarded. Nothing is written to the user's design.
        self.closed = True
        self.root.destroy()

    # --- Internals ----------------------------------------------------------

    def _worker(self, prompt: str) -> None:
        try:
            outcome = self.on_submit(prompt)
        except Exception as exc:  # on_submit should not raise, but never leave the dialog stuck
            outcome = Outcome(ok=False, title="Unexpected error", message=str(exc) or type(exc).__name__)
        self._results.put(outcome)

    def _poll(self) -> None:
        if self.closed:
            return
        try:
            outcome = self._results.get_nowait()
        except queue.Empty:
            self.root.after(_POLL_MS, self._poll)
            return
        self._set_busy(False)
        self._show(outcome)

    def _set_busy(self, busy: bool) -> None:
        self.busy = busy
        self.generate_button.configure(state="disabled" if busy else "normal")
        self.text.configure(state="disabled" if busy else "normal")
        if busy:
            self.status.configure(text="Contacting the backend…", foreground="")
            self.progress.start(12)
        else:
            self.progress.stop()

    def _show(self, outcome: Outcome) -> None:
        self.last_outcome = outcome
        color = "dark green" if outcome.ok else "firebrick"
        self.status.configure(text=f"{outcome.title}: {outcome.message}", foreground=color)

    def _on_text_modified(self, _event: object) -> None:
        length = len(self.prompt_text().strip())
        over = length > MAX_PROMPT_LENGTH
        self.counter.configure(
            text=f"{length} / {MAX_PROMPT_LENGTH}", foreground="firebrick" if over else "gray"
        )
        self.text.edit_modified(False)


def bring_to_front(root: tk.Tk) -> None:
    """The plugin is a separate process, so its window can open behind KiCad."""
    root.update_idletasks()
    root.lift()
    root.attributes("-topmost", True)
    root.after(300, lambda: root.attributes("-topmost", False))
    root.focus_force()


def run_dialog(on_submit: SubmitFn, status_text: str = "") -> Outcome | None:
    """Show the dialog and block until it is closed. Returns the last outcome shown."""
    root = tk.Tk()
    dialog = PromptDialog(root, on_submit, status_text)
    bring_to_front(root)
    root.mainloop()
    return dialog.last_outcome

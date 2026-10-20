"""One CircuitForge window per user, and how the KiCad button talks to it: plain files, no sockets.

Each click of the KiCad button writes `session.json` (KiCad version, open project) into the state folder.
A window that is already open notices the new file, uses that project for saving and comes to the front;
otherwise the plugin starts a window. The open window holds an exclusive lock on `window.lock`, which the
operating system releases if it exits or crashes, so a stale lock can't block the next launch.

Standard library only: the KiCad plugin imports this before anything else.
"""

from __future__ import annotations

import json
import os
import platform
import time
from pathlib import Path
from typing import IO, Any

SESSION_FILE = "session.json"
LOCK_FILE = "window.lock"


def state_dir() -> Path:
    """Per-user folder for the lock, the session hand-off, the window's log and its saved settings."""
    system = platform.system()
    if system == "Darwin":
        base = Path.home() / "Library" / "Application Support"
    elif system == "Windows":
        base = Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local")
    else:
        base = Path(os.environ.get("XDG_STATE_HOME") or Path.home() / ".local" / "state")
    return base / "CircuitForge"


class WindowLock:
    """Held by the open window for its whole life. `acquire` never blocks."""

    def __init__(self, folder: Path) -> None:
        self.path = folder / LOCK_FILE
        self._file: IO[bytes] | None = None

    def acquire(self) -> bool:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        handle = open(self.path, "a+b")
        try:
            if platform.system() == "Windows":
                import msvcrt

                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            handle.close()
            return False
        self._file = handle
        return True

    def release(self) -> None:
        if self._file is None:
            return
        try:
            if platform.system() == "Windows":
                import msvcrt

                self._file.seek(0)
                msvcrt.locking(self._file.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(self._file.fileno(), fcntl.LOCK_UN)
        except OSError:
            pass
        self._file.close()
        self._file = None


def window_running(folder: Path) -> bool:
    lock = WindowLock(folder)
    if lock.acquire():
        lock.release()
        return False
    return True


def write_session(folder: Path, context: dict[str, Any]) -> None:
    """Hand the KiCad session to the window. Written atomically, and different on every click."""
    folder.mkdir(parents=True, exist_ok=True)
    tmp = folder / (SESSION_FILE + ".tmp")
    tmp.write_text(json.dumps({**context, "clicked_at": time.time()}), encoding="utf-8")
    os.replace(tmp, folder / SESSION_FILE)


def read_session(folder: Path) -> dict[str, Any]:
    """The last session the plugin handed over ({} if none or unreadable), without `clicked_at`."""
    try:
        data = json.loads((folder / SESSION_FILE).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    if not isinstance(data, dict):
        return {}
    data.pop("clicked_at", None)
    return data


def clear_session(folder: Path) -> None:
    try:
        (folder / SESSION_FILE).unlink()
    except OSError:
        pass


def session_stamp(folder: Path) -> float | None:
    """Changes whenever the plugin writes a new session (used to spot button clicks)."""
    try:
        return (folder / SESSION_FILE).stat().st_mtime_ns / 1e9
    except OSError:
        return None

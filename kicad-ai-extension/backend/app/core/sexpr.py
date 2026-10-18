"""Minimal S-expression reader/writer for KiCad files.

KiCad files are nested lists of atoms. Quoted strings and bare tokens are
different on disk (`"R1"` vs `yes`), so they are kept distinct here:

- `str` values are quoted strings.
- `Sym` values are bare tokens (keywords, numbers, `yes`/`no`).
- `int`/`float` values are written as bare numbers.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Union


class Sym(str):
    """A bare (unquoted) token."""

    __slots__ = ()

    def __repr__(self) -> str:
        return f"Sym({str(self)!r})"


Atom = Union[str, Sym, int, float]
SExpr = Union[Atom, list["SExpr"]]


class SExprError(ValueError):
    pass


# --- Reading -------------------------------------------------------------------


def _tokens(text: str) -> Iterator[tuple[str, str]]:
    i, n = 0, len(text)
    while i < n:
        c = text[i]
        if c in " \t\r\n":
            i += 1
        elif c in "()":
            yield c, c
            i += 1
        elif c == '"':
            i += 1
            out = []
            while True:
                if i >= n:
                    raise SExprError("unterminated string")
                c = text[i]
                if c == "\\" and i + 1 < n:
                    nxt = text[i + 1]
                    out.append({"n": "\n", "t": "\t", "r": "\r"}.get(nxt, nxt))
                    i += 2
                elif c == '"':
                    i += 1
                    break
                else:
                    out.append(c)
                    i += 1
            yield "str", "".join(out)
        else:
            j = i
            while j < n and text[j] not in ' \t\r\n()"':
                j += 1
            yield "sym", text[i:j]
            i = j


def loads(text: str) -> list[SExpr]:
    """Parse a single top-level S-expression."""
    stack: list[list[SExpr]] = []
    result: list[SExpr] | None = None
    for kind, value in _tokens(text):
        if kind == "(":
            new: list[SExpr] = []
            if stack:
                stack[-1].append(new)
            stack.append(new)
        elif kind == ")":
            if not stack:
                raise SExprError("unbalanced ')'")
            done = stack.pop()
            if not stack:
                if result is not None:
                    raise SExprError("more than one top-level expression")
                result = done
        else:
            if not stack:
                raise SExprError("atom outside of a list")
            stack[-1].append(value if kind == "str" else Sym(value))
    if stack:
        raise SExprError("unbalanced '('")
    if result is None:
        raise SExprError("empty input")
    return result


# --- Writing -------------------------------------------------------------------


def _fmt_number(value: float) -> str:
    if isinstance(value, bool):
        raise TypeError("use Sym('yes')/Sym('no') for booleans")
    if isinstance(value, int):
        return str(value)
    text = f"{value:.4f}".rstrip("0").rstrip(".")
    return "0" if text in ("-0", "") else text


def _fmt_atom(atom: Atom) -> str:
    if isinstance(atom, Sym):
        return str(atom)
    if isinstance(atom, str):
        escaped = atom.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
        return f'"{escaped}"'
    if isinstance(atom, (int, float)):
        return _fmt_number(atom)
    raise TypeError(f"cannot serialize {type(atom).__name__}: {atom!r}")


def dumps(expr: SExpr, indent: int = 0) -> str:
    """Serialize in KiCad's style: one list per line, flat lists inline, tab indentation."""
    if not isinstance(expr, list):
        return _fmt_atom(expr)
    if all(not isinstance(item, list) for item in expr):
        return "(" + " ".join(_fmt_atom(a) for a in expr) + ")"  # type: ignore[arg-type]

    pad = "\t" * (indent + 1)
    head: list[str] = []
    rest = list(expr)
    while rest and not isinstance(rest[0], list):
        head.append(_fmt_atom(rest.pop(0)))  # type: ignore[arg-type]
    lines = ["(" + " ".join(head)]
    for item in rest:
        lines.append(pad + dumps(item, indent + 1))
    lines.append("\t" * indent + ")")
    return "\n".join(lines)


# --- Helpers -------------------------------------------------------------------


def head(expr: SExpr) -> str | None:
    if isinstance(expr, list) and expr and isinstance(expr[0], Sym):
        return str(expr[0])
    return None


def children(expr: list[SExpr], name: str) -> list[list[SExpr]]:
    return [c for c in expr if isinstance(c, list) and head(c) == name]


def child(expr: list[SExpr], name: str) -> list[SExpr] | None:
    found = children(expr, name)
    return found[0] if found else None


def to_float(atom: SExpr) -> float:
    return float(str(atom))

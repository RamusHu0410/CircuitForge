"""KiCad symbol definitions used by the renderer.

The backend ships its own copy of the few official KiCad 10 symbols it needs
(`app/templates/kicad_symbols.kicad_sym`), so rendering does not depend on
where KiCad is installed. Each symbol is stored already flattened (derived
symbols such as `Timer:NE555P` have their parent merged in) and named with its
full `Library:Name` ID, exactly as KiCad embeds it in a schematic's `lib_symbols`.

Regenerate the file from an installed KiCad with `scripts/extract_symbols.py`.
"""

from __future__ import annotations

import copy
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from app.core import sexpr
from app.core.sexpr import SExpr, Sym

VENDORED_SYMBOLS = Path(__file__).resolve().parents[1] / "templates" / "kicad_symbols.kicad_sym"


@dataclass(frozen=True)
class PinInfo:
    number: str
    name: str
    electrical_type: str  # passive, power_in, power_out, input, output, ...
    x: float  # library coordinates (Y up), at the connection point
    y: float
    angle: int  # direction from the connection point toward the symbol body


@dataclass(frozen=True)
class SymbolInfo:
    lib_id: str
    tree: list[SExpr]  # full (symbol "Lib:Name" ...) expression
    pins: tuple[PinInfo, ...]
    is_power: bool

    def pin(self, number: str) -> PinInfo:
        for pin in self.pins:
            if pin.number == number:
                return pin
        raise KeyError(f"{self.lib_id} has no pin {number}")

    def property(self, name: str) -> str | None:
        for prop in sexpr.children(self.tree, "property"):
            if prop[1] == name:
                return str(prop[2])
        return None


def _pins(symbol: list[SExpr]) -> tuple[PinInfo, ...]:
    pins: list[PinInfo] = []
    for unit in sexpr.children(symbol, "symbol"):
        for pin in sexpr.children(unit, "pin"):
            at = sexpr.child(pin, "at")
            name = sexpr.child(pin, "name")
            number = sexpr.child(pin, "number")
            assert at and name and number, f"malformed pin in {symbol[1]}"
            pins.append(
                PinInfo(
                    number=str(number[1]),
                    name=str(name[1]),
                    electrical_type=str(pin[1]),
                    x=sexpr.to_float(at[1]),
                    y=sexpr.to_float(at[2]),
                    angle=int(sexpr.to_float(at[3])) if len(at) > 3 else 0,
                )
            )
    return tuple(pins)


def load_library(path: Path = VENDORED_SYMBOLS) -> dict[str, SymbolInfo]:
    tree = sexpr.loads(path.read_text(encoding="utf-8"))
    symbols: dict[str, SymbolInfo] = {}
    for symbol in sexpr.children(tree, "symbol"):
        lib_id = str(symbol[1])
        symbols[lib_id] = SymbolInfo(
            lib_id=lib_id,
            tree=symbol,
            pins=_pins(symbol),
            is_power=sexpr.child(symbol, "power") is not None,
        )
    return symbols


@lru_cache
def get_library() -> dict[str, SymbolInfo]:
    return load_library()


# --- Extraction from an installed KiCad (used by scripts/extract_symbols.py) ------------


def _find_symbol(lib_tree: list[SExpr], name: str) -> list[SExpr]:
    for symbol in sexpr.children(lib_tree, "symbol"):
        if symbol[1] == name:
            return symbol
    raise KeyError(name)


def flatten_symbol(lib_tree: list[SExpr], library: str, name: str) -> list[SExpr]:
    """Return `(symbol "Library:Name" ...)` with any `extends` parent merged in."""
    symbol = copy.deepcopy(_find_symbol(lib_tree, name))
    extends = sexpr.child(symbol, "extends")
    if extends is None:
        symbol[1] = f"{library}:{name}"
        return symbol

    parent_name = str(extends[1])
    parent = copy.deepcopy(flatten_symbol(lib_tree, library, parent_name))
    child_props = {str(p[1]): p for p in sexpr.children(symbol, "property")}

    merged: list[SExpr] = [Sym("symbol"), f"{library}:{name}"]
    for item in parent[2:]:
        if sexpr.head(item) == "property" and str(item[1]) in child_props:  # type: ignore[index]
            merged.append(child_props.pop(str(item[1])))  # type: ignore[index]
        elif sexpr.head(item) == "symbol":
            unit = copy.deepcopy(item)
            suffix = str(unit[1])[len(parent_name) :]  # type: ignore[index]
            unit[1] = f"{name}{suffix}"  # type: ignore[index]
            merged.append(unit)
        else:
            merged.append(item)
    # Child-only properties (rare) go right after the inherited ones.
    insert_at = max(i for i, item in enumerate(merged) if sexpr.head(item) == "property") + 1
    for prop in child_props.values():
        merged.insert(insert_at, prop)
        insert_at += 1
    return merged


def extract(kicad_symbol_dir: Path, lib_ids: list[str]) -> str:
    """Build the vendored library text for `lib_ids` from KiCad's installed libraries."""
    by_lib: dict[str, list[str]] = {}
    for lib_id in lib_ids:
        library, name = lib_id.split(":", 1)
        by_lib.setdefault(library, []).append(name)

    out: list[SExpr] = [
        Sym("kicad_symbol_lib"),
        [Sym("version"), Sym("20251024")],
        [Sym("generator"), "kicad_ai_schematic_backend"],
        [Sym("generator_version"), "10.0"],
    ]
    for library in sorted(by_lib):
        tree = sexpr.loads((kicad_symbol_dir / f"{library}.kicad_sym").read_text(encoding="utf-8"))
        for name in by_lib[library]:
            out.append(flatten_symbol(tree, library, name))
    return sexpr.dumps(out) + "\n"

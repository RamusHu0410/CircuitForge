from pathlib import Path

import pytest

from app.core import sexpr
from app.core.sexpr import Sym
from app.core.symbol_library import VENDORED_SYMBOLS, load_library


def test_round_trip_preserves_strings_and_symbols() -> None:
    text = '(a (b "x y" yes 1.27) (c "quote \\" back\\\\slash"))'
    tree = sexpr.loads(text)
    assert tree == [Sym("a"), [Sym("b"), "x y", Sym("yes"), Sym("1.27")], [Sym("c"), 'quote " back\\slash']]
    assert isinstance(tree[1][2], Sym) and not isinstance(tree[1][1], Sym)
    assert sexpr.loads(sexpr.dumps(tree)) == tree


def test_numbers_formatting() -> None:
    assert sexpr.dumps([Sym("at"), 1.27, -0.0, 10, 2.5400001]) == "(at 1.27 0 10 2.54)"


@pytest.mark.parametrize("bad", ["(a", "a)", '(a "x', "", "(a) (b)"])
def test_malformed_input_rejected(bad: str) -> None:
    with pytest.raises(sexpr.SExprError):
        sexpr.loads(bad)


def test_vendored_library_loads_with_expected_pins() -> None:
    library = load_library(VENDORED_SYMBOLS)
    assert library["Timer:NE555P"].pin("8").name == "VCC"
    assert library["Regulator_Linear:L7805"].pin("3").electrical_type == "power_out"
    assert library["power:GND"].is_power and not library["Device:R"].is_power
    # Derived symbols are flattened: no `extends`, units renamed to the child.
    ne555 = library["Timer:NE555P"].tree
    assert sexpr.child(ne555, "extends") is None
    assert all(str(u[1]).startswith("NE555P_") for u in sexpr.children(ne555, "symbol"))


def test_vendored_file_is_current(kicad_symbol_dir: Path | None) -> None:
    if kicad_symbol_dir is None:
        pytest.skip("KiCad symbol libraries not installed")
    from app.core.component_registry import all_lib_ids
    from app.core.symbol_library import extract

    assert VENDORED_SYMBOLS.read_text(encoding="utf-8") == extract(kicad_symbol_dir, all_lib_ids())

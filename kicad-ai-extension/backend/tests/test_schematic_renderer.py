"""Rendered schematics: structure always; KiCad ERC + netlist when kicad-cli is installed."""

import itertools

import pytest

from app.ai.circuit_generator import RuleBasedGenerator
from app.core import sexpr
from app.core.circuit_validator import validate_circuit
from app.core.erc import find_kicad_cli, parse_erc_report, run_erc
from app.core.geometry import Grid
from app.core.schematic_renderer import (
    SCHEMATIC_VERSION,
    _hinted_layout,
    named_nets,
    needs_flag,
    needs_power_symbol,
    render_schematic,
    safe_name,
)
from app.core.schematic_wiring import wire_nets
from app.schemas.circuit import Layout, Placement
from tests.test_circuit_generator import ALL_PROMPTS

KICAD_CLI = find_kicad_cli()
needs_kicad = pytest.mark.skipif(KICAD_CLI is None, reason="kicad-cli not installed")


def generate(prompt: str, with_layout: bool = True):
    spec = RuleBasedGenerator().generate(prompt)
    if not with_layout:
        spec = spec.model_copy(update={"layout": None})
    return validate_circuit(spec)


def render(prompt: str, with_layout: bool = True):
    resolved = generate(prompt, with_layout)
    return resolved, render_schematic(resolved, prompt)


def items(text: str, kind: str) -> list:
    return sexpr.children(sexpr.loads(text), kind)


def lib_ids(text: str) -> list[str]:
    return [str(sexpr.child(s, "lib_id")[1]) for s in items(text, "symbol")]


# --- Structure ---------------------------------------------------------------------------


def test_document_structure() -> None:
    _, files = render("A 5V LED with a current-limiting resistor")
    tree = sexpr.loads(files.schematic)

    assert sexpr.head(tree) == "kicad_sch"
    assert str(sexpr.child(tree, "version")[1]) == str(SCHEMATIC_VERSION)
    embedded = {str(s[1]) for s in sexpr.children(sexpr.child(tree, "lib_symbols"), "symbol")}
    assert {"Device:R", "Device:LED", "Device:Battery"} <= embedded
    assert set(lib_ids(files.schematic)) <= embedded  # every placed symbol is embedded

    refs = {}
    for symbol in sexpr.children(tree, "symbol"):
        props = {str(p[1]): str(p[2]) for p in sexpr.children(symbol, "property")}
        refs[props["Reference"]] = props
        if not props["Reference"].startswith("#"):
            assert props["Footprint"], f"{props['Reference']} has no footprint"
    assert refs["BT1"]["Value"] == "5V" and refs["R1"]["Value"] == "330"


def test_led_loop_is_drawn_with_wires_only() -> None:
    """The simplest circuit is a visible loop: battery -> resistor -> LED -> back, no labels or power symbols."""
    resolved, files = render("A 5V LED with a current-limiting resistor")

    assert len(items(files.schematic, "wire")) == 7
    assert items(files.schematic, "label") == []
    assert sorted(lib_ids(files.schematic)) == ["Device:Battery", "Device:LED", "Device:R"]
    assert not any(needs_power_symbol(resolved, net) or needs_flag(resolved, net) for net in resolved.net_pins)


def test_ic_circuits_get_power_symbols_and_flags() -> None:
    resolved, files = render("555 timer blinking a blue LED at 2 Hz on 9V")
    placed = lib_ids(files.schematic)

    assert placed.count("power:+9V") == 1 and placed.count("power:GND") == 1
    assert placed.count("power:PWR_FLAG") == 2
    assert named_nets(resolved) >= {"+9V", "GND", "DISCH", "TIMING"}
    assert len(items(files.schematic, "junction")) >= 5


@pytest.mark.parametrize("prompt", ALL_PROMPTS)
def test_every_template_is_fully_wired(prompt: str) -> None:
    """With the planned layout, every pin is joined by a wire; the only exception is the 555 CONT pin."""
    resolved = generate(prompt)
    grid = Grid()
    placed, buses = _hinted_layout(resolved, grid)
    wiring = wire_nets(resolved, placed, grid, buses)

    failed = {(s.ref, s.number) for nw in wiring.nets.values() for s in nw.failed_sites}
    allowed = {("U1", "5"), ("C2", "1")} if "555" in prompt else set()
    assert failed <= allowed, f"pins joined only by a label: {sorted(failed - allowed)}"


def test_unroutable_connection_falls_back_to_labels() -> None:
    _, files = render("555 timer blinking a blue LED at 2 Hz on 9V")
    labels = {str(label[1]) for label in items(files.schematic, "label")}
    assert "CTRL" in labels  # CONT -> C2 cannot be wired without crossing, so it is joined by name


def test_auto_layout_without_hints_still_wires_and_labels() -> None:
    resolved, files = render("5V regulator from 12V", with_layout=False)
    assert resolved.spec.layout is None
    assert len(items(files.schematic, "wire")) > 10


def test_bad_layout_hints_fall_back_to_auto_layout() -> None:
    spec = RuleBasedGenerator().generate("A 5V LED with a current-limiting resistor")
    broken = spec.model_copy(update={"layout": Layout(placements={"R1": Placement(pin="9", col=0, row=0)})})
    files = render_schematic(validate_circuit(broken))
    assert files.schematic.startswith("(kicad_sch")  # rendered, not an exception


def test_uuids_unique_and_output_deterministic() -> None:
    def generate_text(seed: int) -> str:
        counter = itertools.count(seed)
        resolved = generate("555 blinker on 9V")
        return render_schematic(resolved, "p", new_uuid=lambda: f"00000000-0000-4000-8000-{next(counter):012d}").schematic

    text = generate_text(0)
    assert text == generate_text(0)
    uuids = [line.strip() for line in text.splitlines() if line.strip().startswith("(uuid ")]
    assert len(uuids) == len(set(uuids))


def test_rotated_parts_keep_text_horizontal_and_off_the_body() -> None:
    _, files = render("A 5V LED with a current-limiting resistor")
    led = next(s for s in items(files.schematic, "symbol") if str(sexpr.child(s, "lib_id")[1]) == "Device:LED")
    at = sexpr.child(led, "at")
    assert int(sexpr.to_float(at[3])) in (90, 270)  # vertical LED
    for prop in sexpr.children(led, "property"):
        if str(prop[1]) in ("Reference", "Value"):
            assert sexpr.to_float(sexpr.child(prop, "at")[1]) > sexpr.to_float(at[1]) + 2  # to the right of the part


POT_CIRCUIT = {
    "title": "Pot divider",
    "components": [
        {"ref": "BT1", "kind": "battery", "value": "5V"},
        {"ref": "RV1", "kind": "potentiometer", "value": "10k"},
        {"ref": "R1", "kind": "resistor", "value": "1k"},
    ],
    "nets": [
        {"name": "+5V", "connections": [{"ref": "BT1", "pin": "+"}, {"ref": "RV1", "pin": "1"}]},
        {"name": "WIPER", "connections": [{"ref": "RV1", "pin": "wiper"}, {"ref": "R1", "pin": "1"}]},
        {"name": "GND", "connections": [{"ref": "BT1", "pin": "-"}, {"ref": "RV1", "pin": "3"}, {"ref": "R1", "pin": "2"}]},
    ],
}


def test_off_grid_part_falls_back_to_labels_without_breaking() -> None:
    from app.schemas.circuit import CircuitSpec

    resolved = validate_circuit(CircuitSpec.model_validate(POT_CIRCUIT))
    assert resolved.report.valid
    files = render_schematic(resolved)

    labels = {str(label[1]) for label in items(files.schematic, "label")}
    assert "WIPER" in labels  # the off-grid wiper is joined by name
    if KICAD_CLI:
        from app.core.netlist_check import export_nets

        assert run_erc(files, KICAD_CLI).violations == []
        expected = {frozenset(pins) for pins in resolved.net_pins.values()}
        assert set(export_nets(files, KICAD_CLI).values()) == expected


def test_safe_name() -> None:
    assert safe_name("3.3V Linear regulator!") == "3_3v_linear_regulator"
    assert safe_name("../../etc") == "etc"
    assert safe_name("***") == "ai_circuit"


def test_invalid_circuit_is_not_rendered() -> None:
    from app.schemas.circuit import CircuitSpec

    bad = CircuitSpec.model_validate({
        "title": "bad",
        "components": [{"ref": "U1", "kind": "nope", "value": "x"}],
        "nets": [{"name": "N", "connections": [{"ref": "U1", "pin": "1"}]}],
    })
    with pytest.raises(ValueError):
        render_schematic(validate_circuit(bad))


def test_erc_skipped_without_kicad_cli() -> None:
    _, files = render("low-pass filter at 1kHz")
    report = run_erc(files, None)
    assert report.ran is False and "kicad-cli not found" in report.message


def test_parse_erc_report() -> None:
    report = parse_erc_report({"sheets": [{"violations": [
        {"severity": "error", "type": "pin_not_connected", "description": "Pin not connected",
         "items": [{"description": "Symbol R1 Pin 2"}]},
        {"severity": "warning", "type": "lib_symbol_mismatch", "description": "x", "items": []},
    ]}]})
    assert (report.passed, report.error_count, report.warning_count) == (False, 1, 1)
    assert report.violations[0].items == ["Symbol R1 Pin 2"]


# --- Ground truth from KiCad ------------------------------------------------------------------


@needs_kicad
@pytest.mark.parametrize("with_layout", [True, False], ids=["planned-layout", "auto-layout"])
@pytest.mark.parametrize("prompt", ALL_PROMPTS)
def test_kicad_erc_passes_and_netlist_matches_spec(prompt: str, with_layout: bool) -> None:
    """KiCad opens the file, ERC is clean, and its netlist equals the spec: right wires, right names."""
    from app.core.netlist_check import export_nets

    resolved, files = render(prompt, with_layout)
    erc = run_erc(files, KICAD_CLI)
    assert erc.ran, erc.message
    assert erc.violations == [], [f"{v.type}: {v.description} {v.items}" for v in erc.violations]

    expected = {name: frozenset(pins) for name, pins in resolved.net_pins.items()}
    actual = export_nets(files, KICAD_CLI)
    assert set(actual.values()) == set(expected.values())
    for name in named_nets(resolved):
        assert actual.get(name) == expected[name], f"net {name}"

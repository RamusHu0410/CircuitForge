"""Validation of hand-written (e.g. future LLM) circuit specs."""

from app.core.circuit_validator import validate_circuit
from app.schemas.circuit import CircuitSpec


def spec(components, nets) -> CircuitSpec:
    return CircuitSpec.model_validate({"title": "Test", "components": components, "nets": nets})


def codes(report):
    return [issue.code for issue in report.errors]


R1 = {"ref": "R1", "kind": "resistor", "value": "1k"}
D1 = {"ref": "D1", "kind": "led", "value": "LED"}


def test_pin_aliases_and_names_resolve() -> None:
    resolved = validate_circuit(
        spec([R1, D1], [
            {"name": "A", "connections": [{"ref": "R1", "pin": "2"}, {"ref": "D1", "pin": "anode"}]},
            {"name": "GND", "connections": [{"ref": "D1", "pin": "K"}]},
            {"name": "+5V", "connections": [{"ref": "R1", "pin": "1"}]},
        ])
    )
    assert resolved.report.valid
    assert set(resolved.net_pins["A"]) == {("R1", "2"), ("D1", "2")}


def test_unknown_kind_ref_and_pin() -> None:
    resolved = validate_circuit(
        spec([R1, {"ref": "U1", "kind": "flux_capacitor", "value": "1.21GW"}], [
            {"name": "N1", "connections": [{"ref": "R1", "pin": "3"}, {"ref": "X9", "pin": "1"}]},
        ])
    )
    assert set(codes(resolved.report)) == {"UNKNOWN_COMPONENT", "UNKNOWN_PIN", "UNKNOWN_REF"}


def test_pin_in_two_nets_and_duplicates() -> None:
    resolved = validate_circuit(
        spec([R1, R1], [
            {"name": "N1", "connections": [{"ref": "R1", "pin": "1"}]},
            {"name": "N2", "connections": [{"ref": "R1", "pin": "1"}, {"ref": "R1", "pin": "2"}]},
            {"name": "N2", "connections": [{"ref": "R1", "pin": "2"}]},
        ])
    )
    assert {"DUPLICATE_REF", "DUPLICATE_NET", "PIN_IN_TWO_NETS"} <= set(codes(resolved.report))


def test_unconnected_power_pin_is_error_passive_is_warning() -> None:
    u1 = {"ref": "U1", "kind": "regulator_7805", "value": "L7805"}
    resolved = validate_circuit(
        spec([u1, R1], [{"name": "+5V", "connections": [{"ref": "U1", "pin": "OUT"}, {"ref": "R1", "pin": "1"}]}])
    )
    errors = [(i.code, i.ref) for i in resolved.report.errors]
    assert ("POWER_PIN_UNCONNECTED", "U1") in errors  # IN and GND
    assert [w.code for w in resolved.report.warnings] == ["PIN_UNCONNECTED"]  # R1 pin 2
    assert resolved.unconnected == {"U1": ["1", "2"], "R1": ["2"]}

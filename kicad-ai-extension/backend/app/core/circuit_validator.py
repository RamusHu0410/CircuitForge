"""Deterministic validation of a CircuitSpec against the component registry.

Resolves every pin reference to a real pin number on the KiCad symbol, so the
renderer never has to guess. Nothing is invented: unknown component kinds or
pins are errors.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field

from app.core.component_registry import COMPONENT_KINDS, POWER_SYMBOLS
from app.core.symbol_library import SymbolInfo, get_library
from app.schemas.circuit import CircuitSpec, Issue, ValidationReport


@dataclass
class ResolvedCircuit:
    """The spec with pins resolved to symbol pin numbers. Only valid if no errors."""

    spec: CircuitSpec
    symbols: dict[str, SymbolInfo]  # ref -> symbol
    net_pins: dict[str, list[tuple[str, str]]]  # net -> [(ref, pin number)]
    unconnected: dict[str, list[str]] = field(default_factory=dict)  # ref -> [pin numbers]
    report: ValidationReport = field(default_factory=lambda: ValidationReport(valid=True))


def resolve_pin(symbol: SymbolInfo, aliases: dict[str, str], pin: str) -> str | None:
    """Accept a pin number, a pin name ('VCC', 'A'), or a registry alias ('anode')."""
    wanted = pin.strip()
    numbers = {p.number for p in symbol.pins}
    if wanted in numbers:
        return wanted
    lowered = wanted.lower().lstrip("~{").rstrip("}")
    if lowered in aliases:
        return aliases[lowered]
    for p in symbol.pins:
        name = p.name.lower().replace("~{", "").replace("}", "")
        if name and name == lowered:
            return p.number
    return None


def validate_circuit(spec: CircuitSpec) -> ResolvedCircuit:
    library = get_library()
    errors: list[Issue] = []
    warnings: list[Issue] = []
    symbols: dict[str, SymbolInfo] = {}
    aliases: dict[str, dict[str, str]] = {}

    for ref, count in Counter(c.ref for c in spec.components).items():
        if count > 1:
            errors.append(Issue(code="DUPLICATE_REF", message=f"Reference {ref} is used {count} times.", ref=ref))

    for component in spec.components:
        kind = COMPONENT_KINDS.get(component.kind)
        if kind is None:
            errors.append(
                Issue(
                    code="UNKNOWN_COMPONENT",
                    message=f"{component.ref}: unknown component kind '{component.kind}'. "
                    f"Supported: {', '.join(sorted(COMPONENT_KINDS))}.",
                    ref=component.ref,
                )
            )
            continue
        symbols.setdefault(component.ref, library[kind.lib_id])
        aliases.setdefault(component.ref, kind.pin_aliases)
        if not component.ref.startswith(kind.ref_prefix):
            warnings.append(
                Issue(
                    code="REF_PREFIX",
                    message=f"{component.ref} is a {component.kind}; KiCad convention is prefix '{kind.ref_prefix}'.",
                    ref=component.ref,
                )
            )

    for name, count in Counter(n.name for n in spec.nets).items():
        if count > 1:
            errors.append(Issue(code="DUPLICATE_NET", message=f"Net {name} is defined {count} times.", net=name))

    net_pins: dict[str, list[tuple[str, str]]] = {}
    owner: dict[tuple[str, str], str] = {}
    for net in spec.nets:
        resolved: list[tuple[str, str]] = []
        for conn in net.connections:
            symbol = symbols.get(conn.ref)
            if symbol is None:
                if conn.ref not in {c.ref for c in spec.components}:
                    errors.append(
                        Issue(code="UNKNOWN_REF", message=f"Net {net.name} uses unknown component {conn.ref}.",
                              ref=conn.ref, net=net.name)
                    )
                continue  # unknown kind already reported
            number = resolve_pin(symbol, aliases[conn.ref], conn.pin)
            if number is None:
                available = ", ".join(f"{p.number}({p.name})" if p.name else p.number for p in symbol.pins)
                errors.append(
                    Issue(code="UNKNOWN_PIN",
                          message=f"{conn.ref} has no pin '{conn.pin}'. Available: {available}.",
                          ref=conn.ref, net=net.name)
                )
                continue
            key = (conn.ref, number)
            if key in owner and owner[key] != net.name:
                errors.append(
                    Issue(code="PIN_IN_TWO_NETS",
                          message=f"{conn.ref} pin {number} is connected to both {owner[key]} and {net.name}.",
                          ref=conn.ref, net=net.name)
                )
                continue
            if key in owner:
                continue  # listed twice in the same net; harmless
            owner[key] = net.name
            resolved.append(key)
        net_pins[net.name] = resolved
        if len(resolved) == 1 and net.name not in POWER_SYMBOLS:
            warnings.append(
                Issue(code="SINGLE_PIN_NET", message=f"Net {net.name} connects only one pin.", net=net.name)
            )

    kind_of = {c.ref: COMPONENT_KINDS.get(c.kind) for c in spec.components}
    unconnected: dict[str, list[str]] = {}
    for ref, symbol in symbols.items():
        missing = [p.number for p in symbol.pins if (ref, p.number) not in owner]
        if not missing:
            continue
        unconnected[ref] = missing
        optional = kind_of[ref].optional_pins if kind_of.get(ref) else frozenset()
        for number in missing:
            pin = symbol.pin(number)
            label = f"{number} ({pin.name})" if pin.name else number
            # A power *input* with nothing feeding it is a mistake; an unused power output (a board's
            # 3V3 pin) or a pin the part marks optional (VIN on a USB-powered board) is not.
            if pin.electrical_type == "power_in" and number not in optional:
                errors.append(
                    Issue(code="POWER_PIN_UNCONNECTED", message=f"{ref} power pin {label} is not connected.", ref=ref)
                )
            else:
                warnings.append(
                    Issue(code="PIN_UNCONNECTED",
                          message=f"{ref} pin {label} is not connected; it will be marked no-connect.", ref=ref)
                )

    report = ValidationReport(valid=not errors, errors=errors, warnings=warnings)
    return ResolvedCircuit(spec=spec, symbols=symbols, net_pins=net_pins, unconnected=unconnected, report=report)

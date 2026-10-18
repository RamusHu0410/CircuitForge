"""Render sample circuits, check them with KiCad, and export PNG previews.

    cd backend && python scripts/preview.py [outdir] [prompt ...]

For each prompt: validate, render, run KiCad ERC, compare KiCad's netlist with the intended
connections, and (on macOS) export PNGs next to the .kicad_sch files.
"""

import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.ai.circuit_generator import RuleBasedGenerator  # noqa: E402
from app.core.circuit_validator import validate_circuit  # noqa: E402
from app.core.erc import find_kicad_cli, run_erc  # noqa: E402
from app.core.netlist_check import export_nets  # noqa: E402
from app.core.schematic_renderer import named_nets, render_schematic  # noqa: E402

SAMPLES = [
    "A 5V LED with a current-limiting resistor",
    "3 green LEDs on 12V at 15mA",
    "voltage divider from 12V to 3.3V",
    "low-pass filter at 1kHz",
    "high pass filter cutoff 50 Hz",
    "555 timer blinking a blue LED at 2 Hz on 9V",
    "5V regulator from 12V",
    "3.3V LDO from 5V with power LED",
    "push button with pull-up on 3.3V and debounce",
    "push button with pull-down on 5V",
    "transistor to switch a red LED from a 3.3V GPIO on 5V",
]


def main() -> int:
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/kicad_preview")
    prompts = sys.argv[2:] or SAMPLES
    out.mkdir(parents=True, exist_ok=True)
    cli = find_kicad_cli()
    bad = 0
    for prompt in prompts:
        resolved = validate_circuit(RuleBasedGenerator().generate(prompt))
        files = render_schematic(resolved, prompt)
        (out / f"{files.name}.kicad_sch").write_text(files.schematic)
        (out / f"{files.name}.kicad_pro").write_text(files.project)
        erc = run_erc(files, cli)
        problems = [f"{v.severity} {v.type}: {v.description} {v.items}" for v in erc.violations]
        if cli:
            expected = {n: frozenset(p) for n, p in resolved.net_pins.items()}
            actual = export_nets(files, cli)
            if set(actual.values()) != set(expected.values()):
                problems.append(f"netlist differs: missing {set(expected.values()) - set(actual.values())} "
                                f"extra {set(actual.values()) - set(expected.values())}")
            for net in named_nets(resolved):
                if actual.get(net) != expected[net]:
                    problems.append(f"net name {net!r} not reported by KiCad")
        labels = files.schematic.count("\n\t(label ")
        wires = files.schematic.count("\n\t(wire")
        print(f"{'OK ' if not problems else 'BAD'} {files.name:30} wires={wires:3} labels={labels}")
        for problem in problems:
            print("     -", problem)
        bad += bool(problems)
        if cli and sys.platform == "darwin":
            pdf = out / f"{files.name}.pdf"
            subprocess.run([cli, "sch", "export", "pdf", "-o", str(pdf), str(out / f"{files.name}.kicad_sch")],
                           capture_output=True)
            subprocess.run(["sips", "-s", "format", "png", "--resampleWidth", "1800", str(pdf),
                            "--out", str(out / f"{files.name}.png")], capture_output=True)
    print(f"{len(prompts) - bad}/{len(prompts)} clean; previews in {out}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())

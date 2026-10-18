"""Build the frontend's `Project` (steps, checks, nets) for a design.

The wording and numbers mirror `src/data/example.ts` so the UI reads the same for the example and
for a generated plan. Unlike the example, the verification results are real: the checks come from
the formulas in `jsmath`, and the netlist/ERC lines come from the schematic KiCad actually checked.
"""

from __future__ import annotations

from app.engine import jsmath
from app.engine.design import DesignParams
from app.engine.planner import Plan
from app.schemas.circuit import ErcReport
from app.schemas.frontend import CheckOut, NetOut, PartOut, ProjectOut, StepOut
from app.services.generation_service import Built

RATED_DRAW_MA = 500  # USB port budget quoted in the "power" step


def pin_label(ref: str, built: Built, number: str) -> str:
    """`A1.D13`, `D1.K`, `R2.2`: how the UI names pins (pin name when it has one, else its number)."""
    pin = built.resolved.symbols[ref].pin(number)
    name = pin.name.lstrip("+") or number
    return f"{ref}.{name}"


def build_nets(built: Built) -> list[NetOut]:
    nets = []
    for name, pins in built.resolved.net_pins.items():
        labels: list[str] = []
        for ref, number in pins:
            label = pin_label(ref, built, number)
            if label not in labels:  # the Uno has three GND pins; show them as one "A1.GND"
                labels.append(label)
        nets.append(NetOut(name=name, pins=labels))
    return nets


def _erc_summary(erc: ErcReport) -> tuple[str, str]:
    """(status, line) for the nets step."""
    if not erc.ran:
        return "warning", f"ERC: not run ({erc.message.rstrip('.')})"
    if erc.error_count:
        first = erc.violations[0].description if erc.violations else "see KiCad"
        return "failed", f"ERC: {erc.error_count} error(s), e.g. {first.lower()}"
    if erc.warning_count:
        first = erc.violations[0].description if erc.violations else "see KiCad"
        return "warning", f"ERC: {erc.warning_count} warning(s), e.g. {first.lower()}"
    return "done", "ERC: passed with no violations"


def build_project(plan: Plan, built: Built) -> ProjectOut:
    p: DesignParams = plan.params
    led = jsmath.led_design(p.supply, p.led_vf, p.led_target_ma, p.led_resistor)
    ideal = jsmath.led_design(p.supply, p.led_vf, p.led_target_ma)
    pull = p.supply / p.pull_down
    with_cap = p.debounce_cap_nf > 0
    color = p.led_color
    t = jsmath.tau(p.pull_down, p.debounce_cap_nf) if with_cap else 0.0
    t_low = jsmath.discharge_time(t, jsmath.VIL_FRACTION) if with_cap else 0.0
    nets = build_nets(built)
    pin_count = len({pin for net in nets for pin in net.pins})
    kvl = p.supply - led.current * led.r - p.led_vf
    erc_status, erc_line = _erc_summary(built.erc)
    over_limit = led.current * 1000 > jsmath.PIN_MAX_MA

    steps = [
        StepOut(
            id="parse", title="Read request", call="Parse(request)",
            lines=[f"input: push button · output: {color} LED", "board: Arduino Uno · behaviour: LED on while pressed"],
            status="done", parts=[], lesson="parse",
        ),
        StepOut(
            id="power", title="Pick controller", call="Place(A1)",
            lines=["Arduino Uno, 5 V logic, powered over USB",
                   f"worst-case draw {jsmath.fmt_si(led.current + pull, 'A')} of ~{RATED_DRAW_MA} mA"],
            status="done", parts=[PartOut(ref="A1", name="Arduino Uno", value="ATmega328P")], lesson="power",
        ),
        StepOut(
            id="led", title="Size LED resistor", call="Calculate(R1)",
            lines=[
                f"R = ({jsmath.js_str(p.supply)} − {jsmath.js_str(p.led_vf)}) / {jsmath.js_str(p.led_target_ma)} mA = "
                f"{jsmath.fmt_ohms(ideal.r_ideal)} → {jsmath.fmt_ohms(led.r)}",
                f"I = {jsmath.fmt_si(led.current, 'A')} · P = {jsmath.fmt_si(led.power, 'W')}",
            ],
            status="warning" if over_limit else "done",
            parts=[PartOut(ref="D1", name="LED", value=f"{color.capitalize()}, {p.led_vf:.1f} V"),
                   PartOut(ref="R1", name="Resistor", value=jsmath.fmt_ohms(p.led_resistor))],
            lesson="led",
        ),
        StepOut(
            id="pulldown", title="Read the button", call="Calculate(R2)",
            lines=["SW1 connects 5 V → D2",
                   f"R2 {jsmath.fmt_ohms(p.pull_down)} pull-down · {jsmath.fmt_si(pull, 'A')} when pressed"],
            status="done",
            parts=[PartOut(ref="SW1", name="Push button", value="SPST"),
                   PartOut(ref="R2", name="Resistor", value=jsmath.fmt_ohms(p.pull_down))],
            lesson="pulldown",
        ),
    ]
    if with_cap:
        steps.append(
            StepOut(
                id="debounce", title="Add debounce", call="Calculate(C1)",
                lines=[f"C1 {jsmath.js_str(p.debounce_cap_nf)} nF across R2",
                       f"τ = {jsmath.fmt_si(t, 's')} · reads LOW after {jsmath.fmt_si(t_low, 's')}"],
                status="done",
                parts=[PartOut(ref="C1", name="Capacitor", value=f"{jsmath.js_str(p.debounce_cap_nf)} nF")],
                lesson="debounce",
            )
        )
    steps += [
        StepOut(
            id="nets", title="Wire nets", call=f"Wire({len(nets)} nets)",
            lines=[f"{pin_count} pins, each in exactly one net", erc_line],
            status=erc_status, parts=[], lesson="nets",
        ),
        StepOut(
            id="verify", title="Verify", call="Solve(KVL, KCL)",
            lines=[f"LED loop: {jsmath.js_str(p.supply)} − {jsmath.fmt_si(led.current * led.r, 'V')} − {jsmath.js_str(p.led_vf)} V = 0 V",
                   "current in = current out at every node"],
            status="done" if abs(kvl) < 1e-9 else "failed", parts=[], lesson="verify",
        ),
    ]

    other_unconnected = sum(len(pins) for ref, pins in built.resolved.unconnected.items() if ref != "A1")
    checks = [
        CheckOut(id="c-parse", label="request parsed", status="pass", step_id="parse"),
        CheckOut(
            id="c-led-i",
            label=f"LED {jsmath.fmt_si(led.current, 'A')} ≤ {jsmath.PIN_MAX_MA} mA",
            status="pass" if not over_limit else "fail", step_id="led",
        ),
        CheckOut(
            id="c-led-p",
            label=f"R1 {jsmath.fmt_si(led.power, 'W')} ≤ {jsmath.js_str(jsmath.RESISTOR_RATING_W * 1000)} mW",
            status="pass" if led.power <= jsmath.RESISTOR_RATING_W else "fail", step_id="led",
        ),
        CheckOut(id="c-pull", label="D2 pulled down", status="pass", step_id="pulldown"),
    ]
    if with_cap:
        checks.append(
            CheckOut(id="c-tau", label=f"debounce {jsmath.fmt_si(t_low, 's')}",
                     status="pass" if t_low >= 0.0005 else "warn", step_id="debounce")
        )
    checks.append(
        CheckOut(id="c-pins", label=f"{pin_count - other_unconnected}/{pin_count} pins connected",
                 status="pass" if other_unconnected == 0 else "warn", step_id="nets")
    )
    if not built.erc.ran:
        checks.append(CheckOut(id="c-erc", label="ERC not run", status="warn", step_id="nets"))
    elif not built.erc.violations:
        checks.append(CheckOut(id="c-erc", label="ERC clean", status="pass", step_id="nets"))
    else:
        for i, v in enumerate(built.erc.violations[:5]):
            checks.append(CheckOut(id=f"c-erc-{i}", label=f"ERC: {v.description}",
                                   status="fail" if v.severity == "error" else "warn", step_id="nets"))
    checks.append(CheckOut(id="c-kvl", label="KVL = 0 V", status="pass" if abs(kvl) < 1e-9 else "fail", step_id="verify"))

    summary = ("Built it: " if plan.is_new else "Updated: ") + ", ".join(plan.changes)
    return ProjectOut(
        name="Push-button LED",
        request=plan.request,
        params=p,
        steps=steps,
        checks=checks,
        nets=nets,
        summary=summary,
    )

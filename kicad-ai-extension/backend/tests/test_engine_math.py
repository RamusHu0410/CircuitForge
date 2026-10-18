"""The Python port of src/math.ts must print exactly what the frontend prints.

The plan returned to the UI contains pre-formatted result lines, so any drift would make the
backend's text contradict the frontend's own lessons. These tests run the real TypeScript
(Node 22+ can execute .ts directly) and compare.
"""

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from app.engine import jsmath

ROOT = Path(__file__).resolve().parents[3]
MATH_TS = ROOT / "src" / "math.ts"

needs_node = pytest.mark.skipif(
    shutil.which("node") is None or not MATH_TS.is_file(), reason="node or src/math.ts not available"
)

VALUES = [0, 1, 15, 0.015, 0.0136363636, 0.04090909090909091, 220, 4700, 10000, 2.2e6, 0.001, 1e-5, 1.234e-5,
          3.3, 5, 0.3, 1.2039728043259361, 123456.789, 1e-9, 4.7e-9, 2.5e-7, 1e-7, 1.5e-8]


def run_node(script: str) -> object:
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script], capture_output=True, text=True, timeout=60, check=True
    )
    return json.loads(result.stdout)


def py_js_str(value: float) -> str:
    return jsmath.js_str(value)


@pytest.mark.parametrize(
    ("value", "expected"),
    [(15, "15"), (15.0, "15"), (0.1, "0.1"), (1e-5, "0.00001"), (1e-7, "1e-7"), (1.5e-8, "1.5e-8"), (1e21, "1e+21"),
     (-2.5, "-2.5"), (0, "0"), (123456.789, "123456.789")],
)
def test_js_str_matches_javascript_rules(value: float, expected: str) -> None:
    assert jsmath.js_str(value) == expected


@needs_node
def test_formatters_match_typescript() -> None:
    script = f"""
import {{ trim, fmtOhms, fmtSI }} from "{MATH_TS}";
const v = {json.dumps(VALUES)};
console.log(JSON.stringify({{
  trim: v.map((x) => trim(x)),
  trim2: v.map((x) => trim(x, 2)),
  ohms: v.map((x) => fmtOhms(x)),
  si: v.map((x) => fmtSI(x, "A")),
  si2: v.map((x) => fmtSI(x, "s", 2)),
}}));
"""
    expected = run_node(script)
    assert expected["trim"] == [jsmath.trim(x) for x in VALUES]
    assert expected["trim2"] == [jsmath.trim(x, 2) for x in VALUES]
    assert expected["ohms"] == [jsmath.fmt_ohms(x) for x in VALUES]
    assert expected["si"] == [jsmath.fmt_si(x, "A") for x in VALUES]
    assert expected["si2"] == [jsmath.fmt_si(x, "s", 2) for x in VALUES]


@needs_node
def test_led_design_and_rc_match_typescript() -> None:
    cases = [(5, 2.0, 15, None), (5, 2.0, 15, 220), (3.3, 2.0, 10, None), (5, 3.1, 20, None), (3.3, 3.1, 10, None),
             (5, 2.2, 5, None), (5, 2.0, 1, None), (12, 2.0, 15, 680)]
    script = f"""
import {{ ledDesign, tau, dischargeTime, nextE12 }} from "{MATH_TS}";
const cases = {json.dumps(cases)};
console.log(JSON.stringify({{
  led: cases.map(([s, vf, ma, r]) => ledDesign(s, vf, ma, r ?? undefined)),
  e12: [1, 9, 100, 101, 220, 221, 4500, 91000, 0.5].map(nextE12),
  rc: [[10000, 100], [4700, 47], [100000, 220]].map(([r, c]) => [tau(r, c), dischargeTime(tau(r, c), 0.3)]),
}}));
"""
    expected = run_node(script)
    for (supply, vf, ma, fixed), want in zip(cases, expected["led"]):
        got = jsmath.led_design(supply, vf, ma, fixed)
        assert (got.ok, got.r_ideal, got.r, got.current, got.power) == pytest.approx(
            (want["ok"], want["rIdeal"], want["r"], want["current"], want["power"]), rel=1e-12
        )
    assert [jsmath.next_e12(x) for x in [1, 9, 100, 101, 220, 221, 4500, 91000, 0.5]] == pytest.approx(expected["e12"])
    for (r, c), want in zip([(10000, 100), (4700, 47), (100000, 220)], expected["rc"]):
        t = jsmath.tau(r, c)
        assert (t, jsmath.discharge_time(t, 0.3)) == pytest.approx(tuple(want), rel=1e-12)

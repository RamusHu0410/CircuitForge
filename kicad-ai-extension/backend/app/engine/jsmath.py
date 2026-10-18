"""Python port of the frontend's `frontend/math.ts`.

The plan the backend returns contains pre-formatted result lines ("R = (5 − 2) / 15 mA = ..."),
so the numbers and text must match what the frontend's own lessons compute. A test runs
the real TypeScript and compares (tests/test_engine_math.py).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from decimal import Decimal

E12 = [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2]

# ATmega328P (Arduino Uno) input thresholds at 5 V (same table as the frontend).
VIL_FRACTION = 0.3
PIN_MAX_MA = 20
PIN_ABS_MAX_MA = 40
RESISTOR_RATING_W = 0.25


def js_str(value: float) -> str:
    """`String(number)` as JavaScript prints it: 15 (not 15.0), 0.00001, and 1e-7 / 1.5e+21 at the extremes."""
    if value == 0:
        return "0"
    if value != value:
        return "NaN"
    if value in (float("inf"), float("-inf")):
        return "Infinity" if value > 0 else "-Infinity"
    magnitude = abs(value)
    shortest = Decimal(repr(float(value)))  # Python and JS both print the shortest round-trip digits
    if 1e-6 <= magnitude < 1e21:
        text = format(shortest, "f")
        return text[:-2] if text.endswith(".0") else text
    sign, digits, exponent = shortest.normalize().as_tuple()
    power = len(digits) - 1 + exponent
    mantissa = str(digits[0]) + ("." + "".join(map(str, digits[1:])) if len(digits) > 1 else "")
    return f"{'-' if sign else ''}{mantissa}e{'+' if power >= 0 else '-'}{abs(power)}"


def trim(value: float, digits: int = 3) -> str:
    """`String(Number(v.toPrecision(digits)))`."""
    if value == 0:
        return "0"
    return js_str(float(f"{value:.{digits - 1}e}"))


def next_e12(r: float) -> float:
    """Smallest standard E12 value >= r (rounding up keeps the LED current under target)."""
    if r <= 0:
        return 0.0
    decade = 10 ** math.floor(math.log10(r))
    for m in [*E12, 10.0]:
        v = round(m * decade * 1000) / 1000
        if v >= r - 1e-9:
            return v
    return 10 * decade


@dataclass(frozen=True)
class LedDesign:
    ok: bool
    r_ideal: float  # Ω, exact Ohm's-law answer
    r: float  # Ω, standard part chosen
    current: float  # A, actual current with the standard part
    power: float  # W, dissipated in the resistor


def led_design(supply: float, vf: float, target_ma: float, fixed_r: float | None = None) -> LedDesign:
    """R = (Vs − Vf) / I, then round up to a real resistor and recompute I and P = I²R."""
    headroom = supply - vf
    if headroom <= 0 or target_ma <= 0:
        return LedDesign(False, 0, 0, 0, 0)
    r_ideal = headroom / (target_ma / 1000)
    r = fixed_r if fixed_r is not None else next_e12(r_ideal)
    current = headroom / r
    return LedDesign(True, r_ideal, r, current, current * current * r)


def tau(r: float, cap_nf: float) -> float:
    return r * cap_nf * 1e-9


def discharge_time(tau_s: float, fraction: float) -> float:
    return tau_s * math.log(1 / fraction)


def fmt_ohms(r: float) -> str:
    if r >= 1e6:
        return f"{trim(r / 1e6)} MΩ"
    if r >= 1e3:
        return f"{trim(r / 1e3)} kΩ"
    return f"{trim(r)} Ω"


def _si_parts(v: float, digits: int) -> tuple[str, str]:
    a = abs(v)
    if a == 0 or a >= 1:
        return trim(v, digits), ""
    if a >= 1e-3:
        return trim(v * 1e3, digits), "m"
    if a >= 1e-6:
        return trim(v * 1e6, digits), "µ"
    return trim(v * 1e9, digits), "n"


def fmt_si(v: float, unit: str, digits: int = 3) -> str:
    num, prefix = _si_parts(v, digits)
    return f"{num} {prefix}{unit}"

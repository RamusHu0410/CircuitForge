"""Behaviour that needs a program: buttons + LEDs on an Arduino Nano, and its C++ firmware.

A prompt like "red LED blinks when the button is pressed once, green LED blinks if it's
pressed twice within 0.5 s" can't be built from passive parts: something has to count
presses and keep time. This module reads that behaviour from the prompt (rule-based,
deterministic) and produces:

- `McuPlan`: which buttons/LEDs exist, which pins they use, and the behaviours;
- `arduino_sketch(plan)`: a non-blocking Arduino C++ sketch implementing exactly that.

The schematic template (circuit_generator.microcontroller) uses the same plan, so the
pins in the code always match the drawing.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

BOARD = "Arduino Nano (ATmega328P)"
BUTTON_PINS = ["A0", "A1"]  # analog pins used as digital inputs (internal pull-ups; pressed = LOW)
LED_PINS = [9, 10, 11, 12]  # D9..D12, each through its own resistor
COLORS = ["red", "green", "blue", "yellow", "white", "orange"]

MAX_BUTTONS = len(BUTTON_PINS)
MAX_LEDS = len(LED_PINS)

_MCU_WORDS = ("arduino", "microcontroller", "mcu", "atmega", "firmware", "nano")
_BEHAVIOUR = re.compile(
    r"\b(once|twice|double|triple|three times|two times|\d+\s*times|toggle|toggles|long[- ]press|"
    r"hold|holds|held|holding|within|under|blinks?|blinking|flash(?:es|ing)?|clicks?)\b",
    re.I,
)
_DURATION = re.compile(r"(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|secs?|seconds?)\b", re.I)
_BLINK_TIMES = re.compile(r"\b(?:blinks?|flash(?:es)?)\s+(\d+)\s*times\b", re.I)
_NUMBER_WORDS = {"two": 2, "2": 2, "three": 3, "3": 3, "four": 4, "4": 4}


@dataclass(frozen=True)
class Behaviour:
    button: int  # 0-based index into BUTTON_PINS
    trigger: str  # "press" | "double" | "triple" | "long" | "held"
    action: str  # "blink" | "on" | "toggle" | "follow"
    led: int  # 0-based index into the plan's LEDs
    times: int = 3  # blinks
    duration_ms: int = 1000  # how long "on" lasts

    def describe(self, leds: list[str]) -> str:
        who = f"{leds[self.led]} LED"
        what = {
            "blink": f"{who} blinks {self.times} times",
            "on": f"{who} turns on for {self.duration_ms / 1000:g} s",
            "toggle": f"{who} toggles on/off",
            "follow": f"{who} is on while the button is held",
        }[self.action]
        when = {
            "press": "Press once",
            "double": "Press twice quickly",
            "triple": "Press three times quickly",
            "long": "Hold the button",
            "held": "Hold the button",
        }[self.trigger]
        btn = f" button {self.button + 1}" if self.button else ""
        return f"{when}{btn}: {what}"


@dataclass(frozen=True)
class McuPlan:
    buttons: int
    leds: list[str]
    behaviours: list[Behaviour]
    multi_press_ms: int = 400
    long_press_ms: int = 800
    blink_ms: int = 150
    assumptions: list[str] = field(default_factory=list)


def _has(prompt: str, *words: str) -> bool:
    return any(re.search(rf"\b{re.escape(w)}", prompt, re.I) for w in words)


def needs_microcontroller(prompt: str) -> bool:
    """True when the prompt asks for behaviour (counting presses, timing, blinking on demand)."""
    if _has(prompt, *_MCU_WORDS):
        return True
    has_button = _has(prompt, "button", "switch", "press")
    has_led = _has(prompt, "led", "light")
    return has_button and has_led and _BEHAVIOUR.search(prompt) is not None


def _ms(match: re.Match[str]) -> int:
    value, unit = float(match.group(1)), match.group(2).lower()
    return int(round(value if unit.startswith("m") else value * 1000))


def _clauses(prompt: str) -> list[str]:
    color_alt = "|".join(COLORS)
    parts = [p.strip() for p in re.split(rf"[,;]|\.(?!\d)|\bthen\b|\band\b(?=\s+(?:the\s+|a\s+)?(?:{color_alt})\b)", prompt, flags=re.I)]
    # "green and yellow LEDs blink ..." splits into "green" + "yellow LEDs blink ...": a piece with
    # no trigger of its own belongs to the next one.
    clauses: list[str] = []
    carry = ""
    for part in (p for p in parts if p):
        if _trigger(part) is None and re.search(rf"\b({color_alt})\b", part, re.I) and not _BEHAVIOUR.search(part):
            carry += part + " and "
            continue
        clauses.append(carry + part)
        carry = ""
    if carry:
        clauses.append(carry.removesuffix(" and "))
    return clauses


def _trigger(clause: str) -> str | None:
    c = clause.lower()
    if re.search(r"\b(three times|3 times|triple|thrice)\b", c):
        return "triple"
    if re.search(r"\b(twice|two times|2 times|double)\b", c):
        return "double"
    if re.search(r"\b(while|as long as)\b.*\b(held|pressed|down|holding|hold)\b", c):
        return "held"
    if re.search(r"\blong[- ]press|\bpress and hold\b|\b(hold|held|holding)\b", c):
        return "long"
    if re.search(r"\b(press|pressed|presses|push|pushed|click|clicked|tap|tapped|once)\b", c):
        return "press"
    return None


def _action(clause: str, trigger: str) -> str:
    c = clause.lower()
    if re.search(r"\b(blinks?|blinking|flash(?:es|ing)?)\b", c):
        return "blink"
    if re.search(r"\btoggles?\b", c):
        return "toggle"
    if trigger == "held":
        return "follow"
    return "on"


def plan_from_prompt(prompt: str) -> McuPlan:
    assumptions: list[str] = []

    # LEDs: one per colour mentioned (in order); otherwise "N LEDs" of red.
    mentioned = [m.group(1).lower() for m in re.finditer(rf"\b({'|'.join(COLORS)})\b", prompt, re.I)]
    leds: list[str] = []
    for color in mentioned:
        if color not in leds:
            leds.append(color)
    if not leds:
        count = re.search(r"\b(two|three|four|2|3|4)\s+leds?\b", prompt, re.I)
        leds = ["red"] * (_NUMBER_WORDS.get(count.group(1).lower(), 1) if count else 1)
        assumptions.append("No LED colour given, so red LEDs are used.")
    if len(leds) > MAX_LEDS:
        assumptions.append(f"Only the first {MAX_LEDS} LEDs are used (D9-D12).")
        leds = leds[:MAX_LEDS]

    two_buttons = re.search(r"\b(two|2)\s+(?:push\s*)?buttons\b|\bsecond button\b|\bbutton\s*2\b", prompt, re.I)
    buttons = 2 if two_buttons else 1

    multi_ms, long_ms = 400, 800
    behaviours: list[Behaviour] = []
    for clause in _clauses(prompt):
        trigger = _trigger(clause)
        colors = [m.group(1).lower() for m in re.finditer(rf"\b({'|'.join(COLORS)})\b", clause, re.I)]
        targets = [leds.index(c) for c in colors if c in leds] or ([0] if len(leds) == 1 else [])
        if trigger is None or not targets:
            continue
        action = _action(clause, trigger)
        button = 1 if buttons == 2 and re.search(r"\b(second|other|button\s*2)\b", clause, re.I) else 0
        times = int(m.group(1)) if (m := _BLINK_TIMES.search(clause)) else 3
        duration = _DURATION.search(clause)
        on_ms = 1000
        if duration:
            if trigger in ("double", "triple") and re.search(r"\b(within|under|less than|in)\b", clause, re.I):
                multi_ms = _ms(duration)
            elif trigger == "long":
                long_ms = _ms(duration)
            elif action == "on":
                on_ms = _ms(duration)
        for led in targets:
            behaviours.append(Behaviour(button, trigger, action, led, max(1, min(times, 20)), on_ms))

    if not behaviours:
        behaviours = [Behaviour(0, "held", "follow", i) for i in range(len(leds))]
        assumptions.append("No behaviour recognised, so each LED is on while the button is held.")

    multi_ms = max(150, min(multi_ms, 2000))
    if any(b.trigger in ("double", "triple") for b in behaviours) and any(b.trigger == "press" for b in behaviours):
        assumptions.append(
            f"A single press reacts {multi_ms} ms after release: the program waits that long to be sure it isn't a double press."
        )
    return McuPlan(buttons, leds, behaviours, multi_ms, max(300, min(long_ms, 5000)), 150, assumptions)


# --- C++ -------------------------------------------------------------------------------

_EVENT = {"press": "EV_PRESS", "double": "EV_DOUBLE", "triple": "EV_TRIPLE", "long": "EV_LONG", "held": "EV_DOWN"}


def _action_code(b: Behaviour, plan: McuPlan) -> str:
    if b.action == "blink":
        return f"blinkLed({b.led}, {b.times});"
    if b.action == "on":
        return f"lightLed({b.led}, {b.duration_ms}UL);"
    if b.action == "toggle":
        return f"toggleLed({b.led});"
    return f"setLed({b.led}, true);"


def arduino_sketch(plan: McuPlan, title: str, resistors: list[str] | None = None) -> str:
    leds, n_btn, n_led = plan.leds, plan.buttons, len(plan.leds)
    wait_multi = [any(b.button == i and b.trigger in ("double", "triple") for b in plan.behaviours) for i in range(n_btn)]
    has_long = [any(b.button == i and b.trigger == "long" for b in plan.behaviours) for i in range(n_btn)]
    cpp_bool = lambda flags: ", ".join("true" if f else "false" for f in flags)  # noqa: E731
    resistors = resistors or ["330 ohm"] * n_led

    lines: list[str] = []
    add = lines.append
    add(f"// {title}")
    add(f"// Generated by CircuitForge for an {BOARD}. Edit it freely.")
    add("//")
    add("// What it does:")
    for b in plan.behaviours:
        add(f"//   - {b.describe(leds)}")
    add("//")
    add("// Wiring (matches the schematic):")
    for i in range(n_btn):
        add(f"//   SW{i + 1}: {BUTTON_PINS[i]} to GND, using the internal pull-up (pressed reads LOW)")
    for i, color in enumerate(leds):
        add(f"//   D{LED_PINS[i]} -> R{i + 1} ({resistors[i]}) -> {color} LED D{i + 1} -> GND")
    add("")
    add(f"const uint8_t NUM_BUTTONS = {n_btn};")
    add(f"const uint8_t NUM_LEDS = {n_led};")
    add(f"const uint8_t BUTTON_PINS[NUM_BUTTONS] = {{{', '.join(str(p) for p in BUTTON_PINS[:n_btn])}}};")
    add(f"const uint8_t LED_PINS[NUM_LEDS] = {{{', '.join(str(p) for p in LED_PINS[:n_led])}}};  // {', '.join(leds)}")
    add("")
    add("const unsigned long DEBOUNCE_MS = 30;      // ignore contact bounce shorter than this")
    add(f"const unsigned long MULTI_PRESS_MS = {plan.multi_press_ms};  // presses closer than this make a double/triple press")
    add(f"const unsigned long LONG_PRESS_MS = {plan.long_press_ms};   // hold at least this long for a long press")
    add(f"const unsigned long BLINK_MS = {plan.blink_ms};       // on/off time while blinking")
    add("")
    add("// Buttons that need to wait for a possible second press, or detect long presses.")
    add(f"const bool WAITS_FOR_MULTI[NUM_BUTTONS] = {{{cpp_bool(wait_multi)}}};")
    add(f"const bool DETECTS_LONG[NUM_BUTTONS] = {{{cpp_bool(has_long)}}};")
    add("")
    add("enum ButtonEvent : uint8_t { EV_PRESS, EV_DOUBLE, EV_TRIPLE, EV_LONG, EV_DOWN, EV_UP };")
    add("")
    add("struct Led { bool on; uint8_t togglesLeft; unsigned long nextToggle; unsigned long offAt; bool timed; };")
    add("struct Button { bool down; bool lastRaw; unsigned long lastFlip; uint8_t presses; unsigned long lastRelease; unsigned long pressedAt; bool longFired; };")
    add("")
    add("Led leds[NUM_LEDS];")
    add("Button buttons[NUM_BUTTONS];")
    add("")
    add("void setLed(uint8_t i, bool on) {")
    add("  leds[i].on = on;")
    add("  digitalWrite(LED_PINS[i], on ? HIGH : LOW);")
    add("}")
    add("")
    add("void blinkLed(uint8_t i, uint8_t times) {  // non-blocking: updateLeds() does the blinking")
    add("  leds[i].timed = false;")
    add("  setLed(i, false);")
    add("  leds[i].togglesLeft = times * 2;")
    add("  leds[i].nextToggle = millis();")
    add("}")
    add("")
    add("void lightLed(uint8_t i, unsigned long ms) {")
    add("  leds[i].togglesLeft = 0;")
    add("  setLed(i, true);")
    add("  leds[i].offAt = millis() + ms;")
    add("  leds[i].timed = true;")
    add("}")
    add("")
    add("void toggleLed(uint8_t i) {")
    add("  leds[i].togglesLeft = 0;")
    add("  leds[i].timed = false;")
    add("  setLed(i, !leds[i].on);")
    add("}")
    add("")
    add("// Your behaviour: what each button event does.")
    add("void handle(uint8_t button, ButtonEvent event) {")
    for b in plan.behaviours:
        add(f"  if (button == {b.button} && event == {_EVENT[b.trigger]}) {_action_code(b, plan)}  // {b.describe(leds)}")
        if b.action == "follow":
            add(f"  if (button == {b.button} && event == EV_UP) setLed({b.led}, false);")
    add("}")
    add("")
    add("void updateButtons() {")
    add("  unsigned long now = millis();")
    add("  for (uint8_t i = 0; i < NUM_BUTTONS; i++) {")
    add("    Button &b = buttons[i];")
    add("    bool raw = digitalRead(BUTTON_PINS[i]) == LOW;  // pull-up: pressed = LOW")
    add("    if (raw != b.lastRaw) {")
    add("      b.lastRaw = raw;")
    add("      b.lastFlip = now;")
    add("    }")
    add("    if (raw != b.down && now - b.lastFlip >= DEBOUNCE_MS) {")
    add("      b.down = raw;")
    add("      if (b.down) {")
    add("        b.pressedAt = now;")
    add("        b.longFired = false;")
    add("        handle(i, EV_DOWN);")
    add("        if (!WAITS_FOR_MULTI[i] && !DETECTS_LONG[i]) handle(i, EV_PRESS);  // nothing to wait for: react now")
    add("      } else {")
    add("        handle(i, EV_UP);")
    add("        if (!b.longFired && (WAITS_FOR_MULTI[i] || DETECTS_LONG[i])) {")
    add("          b.presses++;")
    add("          b.lastRelease = now;")
    add("        }")
    add("      }")
    add("    }")
    add("    if (DETECTS_LONG[i] && b.down && !b.longFired && now - b.pressedAt >= LONG_PRESS_MS) {")
    add("      b.longFired = true;")
    add("      b.presses = 0;")
    add("      handle(i, EV_LONG);")
    add("    }")
    add("    if (!b.down && b.presses > 0 && (!WAITS_FOR_MULTI[i] || now - b.lastRelease >= MULTI_PRESS_MS)) {")
    add("      handle(i, b.presses >= 3 ? EV_TRIPLE : b.presses == 2 ? EV_DOUBLE : EV_PRESS);")
    add("      b.presses = 0;")
    add("    }")
    add("  }")
    add("}")
    add("")
    add("void updateLeds() {")
    add("  unsigned long now = millis();")
    add("  for (uint8_t i = 0; i < NUM_LEDS; i++) {")
    add("    Led &l = leds[i];")
    add("    if (l.togglesLeft > 0 && (long)(now - l.nextToggle) >= 0) {")
    add("      setLed(i, !l.on);")
    add("      l.togglesLeft--;")
    add("      l.nextToggle = now + BLINK_MS;")
    add("    }")
    add("    if (l.timed && (long)(now - l.offAt) >= 0) {")
    add("      l.timed = false;")
    add("      setLed(i, false);")
    add("    }")
    add("  }")
    add("}")
    add("")
    add("void setup() {")
    add("  for (uint8_t i = 0; i < NUM_BUTTONS; i++) {")
    add("    pinMode(BUTTON_PINS[i], INPUT_PULLUP);")
    add("    buttons[i] = Button{false, false, 0, 0, 0, 0, false};")
    add("  }")
    add("  for (uint8_t i = 0; i < NUM_LEDS; i++) {")
    add("    pinMode(LED_PINS[i], OUTPUT);")
    add("    leds[i] = Led{false, 0, 0, 0, false};")
    add("    setLed(i, false);")
    add("  }")
    add("}")
    add("")
    add("void loop() {")
    add("  updateButtons();")
    add("  updateLeds();")
    add("}")
    return "\n".join(lines) + "\n"

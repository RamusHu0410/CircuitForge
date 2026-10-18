"""Rule-based reading of a microcontroller project description into a SystemPlan.

It recognizes the building blocks a description mentions (joysticks, buttons, knobs, LEDs, a buzzer),
how many of each, and a few game recipes (football, pong, ...) that expand into sensible LED
displays: a ball-position bar and a score row per player. The numbers are counted from the text; the
electronics are decided later by the synthesizer.
"""

from __future__ import annotations

import re

from app.ai.circuit_generator import LED_VF, GenerationError
from app.schemas.system import Button, Buzzer, Joystick, Knob, LedGroup, SystemPlan

_NUMBERS = {
    "a": 1, "an": 1, "one": 1, "single": 1, "two": 2, "three": 3, "four": 4,
    "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10, "twelve": 12,
}
_NUM = r"(\d+|a|an|one|single|two|three|four|five|six|seven|eight|nine|ten|twelve)"

# Words that mean "this is a microcontroller project", not one of the single-circuit templates.
_TRIGGER = re.compile(
    r"\b(joysticks?|game|games|players?|arduino|uno|microcontrollers?|mcu|buzzers?|speakers?|beepers?|"
    r"scoreboard|score|scoring|football|soccer|pong|hockey|knobs?|potentiometers?)\b"
)
_BALL_GAMES = re.compile(r"\b(football|soccer|pong|hockey|ball)\b")
_SCORE_COLORS = ["green", "red", "blue", "orange", "white", "yellow"]
DEFAULT_BALL_LEDS = 7
DEFAULT_SCORE_LEDS = 3


def wants_system(prompt: str) -> bool:
    return bool(_TRIGGER.search(prompt.lower()))


def _count(token: str) -> int:
    return _NUMBERS.get(token) or int(token)


_ADJECTIVES = (
    r"(?:(?:red|orange|yellow|green|blue|white|status|indicator|score|small|analog|arcade|thumb|"
    r"push|momentary|tactile|rotary|slide)[- ]){0,2}"
)


def _find_count(text: str, noun: str) -> int | None:
    """'two joysticks' / '3 red leds' -> the number before the noun, allowing colour/type words between."""
    match = re.search(rf"\b{_NUM}\s+{_ADJECTIVES}{noun}\b", text)
    return _count(match.group(1)) if match else None


def _color(text: str, default: str) -> str:
    for color in LED_VF:
        if re.search(rf"\b{color}\b", text):
            return color
    return default


def plan_system(prompt: str) -> SystemPlan:
    text = " ".join(prompt.lower().split())
    modules: list = []

    players = None
    if (m := re.search(rf"\b{_NUM}[- ]players?\b", text)) and m.group(1) not in ("a", "an"):
        players = _count(m.group(1))
    elif re.search(r"\bsingle[- ]player\b", text):
        players = 1
    game = bool(re.search(r"\b(game|football|soccer|pong|hockey|versus|vs)\b", text)) or players is not None
    sport = next((w for w in ("football", "soccer", "pong", "hockey") if re.search(rf"\b{w}\b", text)), None)

    # Inputs
    joysticks = _find_count(text, r"joysticks?")
    if joysticks is None and re.search(r"\bjoysticks?\b", text):
        joysticks = players or 1
    if joysticks:
        for n in range(1, joysticks + 1):
            label = f"P{n}" if (game or joysticks > 1) else "JOY"
            modules.append(Joystick(label=label, purpose=f"player {n} control" if game else ""))

    knobs = _find_count(text, r"(?:potentiometers?|knobs?|dials?)")
    if knobs is None and re.search(r"\b(potentiometers?|knobs?|dials?)\b", text):
        knobs = 1
    for n in range(1, (knobs or 0) + 1):
        modules.append(Knob(label=f"POT{n}" if (knobs or 0) > 1 else "POT"))

    buttons = _find_count(text, r"(?:push[- ]?)?buttons?")
    if buttons is None and re.search(r"\b(push[- ]?)?buttons?\b", text):
        buttons = 1
    for n in range(1, (buttons or 0) + 1):
        modules.append(Button(label=f"BTN{n}" if (buttons or 0) > 1 else "BTN"))

    # Outputs
    leds_mentioned = bool(re.search(r"\bleds?\b|\blights?\b|\bindicat", text))
    explicit_leds = _find_count(text, r"leds?")
    scoring = bool(re.search(r"\bscor", text))
    default_color = _color(text, "red")

    if game:
        ball = bool(sport or _BALL_GAMES.search(text))
        if ball and (leds_mentioned or scoring or sport):
            size = explicit_leds if explicit_leds and explicit_leds >= 3 else DEFAULT_BALL_LEDS
            modules.append(LedGroup(label="BALL", count=min(size, 16), color="yellow",
                                    purpose="ball position across the field, left goal to right goal"))
        elif leds_mentioned and re.search(r"\b(state|status)\b", text):
            modules.append(LedGroup(label="STATE", count=3, color="white", purpose="game state: ready, playing, game over"))
        if scoring or leds_mentioned:
            first_to = re.search(r"\bfirst to (\d+)\b", text)
            per_player = min(int(first_to.group(1)), 6) if first_to and int(first_to.group(1)) > 0 else DEFAULT_SCORE_LEDS
            for n in range(1, (players or joysticks or 2) + 1):
                modules.append(LedGroup(label=f"SC{n}", count=per_player, color=_SCORE_COLORS[(n - 1) % len(_SCORE_COLORS)],
                                        purpose=f"player {n} score"))
    elif leds_mentioned:
        modules.append(LedGroup(label="LED", count=min(explicit_leds or 1, 16), color=default_color))

    if re.search(r"\b(buzzers?|speakers?|beepers?|piezo|beeps?|sounds?)\b", text):
        modules.append(Buzzer(label="BUZZ"))

    if not modules:
        raise GenerationError(
            "That looks like a microcontroller project, but I couldn't find any inputs or outputs in it. "
            "Mention what it should use, for example joysticks, buttons, knobs, LEDs or a buzzer."
        )

    title = _title(players, sport, game, modules)
    return SystemPlan(title=title, description=_describe(modules), modules=modules)


def _title(players: int | None, sport: str | None, game: bool, modules: list) -> str:
    if game:
        who = f"{players}-player " if players else ""
        return f"{who}{sport + ' ' if sport else ''}game controller".replace("  ", " ").strip().capitalize()
    kinds = sorted({type(m).__name__.lower() for m in modules})
    return f"Arduino project ({', '.join(kinds)})"[:80]


def _describe(modules: list) -> str:
    parts = []
    for m in modules:
        if isinstance(m, LedGroup):
            parts.append(f"{m.count} {m.color} LED{'s' if m.count > 1 else ''} ({m.label})")
        else:
            parts.append(f"{type(m).__name__.lower()} {m.label}")
    return "Arduino Uno with " + ", ".join(parts) + "."

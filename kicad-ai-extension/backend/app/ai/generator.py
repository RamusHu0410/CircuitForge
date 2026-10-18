"""Choose how a prompt becomes a CircuitSpec.

Order of attempts
0. Button/LED behaviour ("red LED blinks on a double press"): the Arduino Nano template, which also
   gets C++ firmware with the same pins (see GenerationService._firmware). Always by rules.
1. Language model (only if configured): prompt -> SystemPlan -> synthesizer.
2. Microcontroller projects by rules (joysticks, games, LEDs, buzzers, ...): prompt -> SystemPlan -> synthesizer.
3. Single-circuit templates (555 blinker, regulator, divider, filter, ...).
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Literal

from app.ai.circuit_generator import GenerationError, RuleBasedGenerator
from app.ai.firmware import needs_microcontroller
from app.ai.llm_planner import LlmError, LlmPlanner
from app.ai.system_designer import build_system
from app.ai.system_rules import plan_system, wants_system
from app.config import Settings
from app.schemas.circuit import CircuitSpec
from app.schemas.system import SystemPlan

logger = logging.getLogger(__name__)

# Parts only the system designer (Arduino Uno) builds. Without them, a behaviour prompt is a firmware project.
_SYSTEM_PARTS = re.compile(
    r"\b(joysticks?|games?|players?|uno|buzzers?|speakers?|beepers?|scoreboard|score|scoring|football|soccer|"
    r"pong|hockey|knobs?|potentiometers?|shift registers?|74hc595)\b",
    re.I,
)


def wants_firmware(prompt: str) -> bool:
    """Buttons and LEDs with behaviour (presses, timing, blinking): the Nano template plus its firmware."""
    return needs_microcontroller(prompt) and not _SYSTEM_PARTS.search(prompt)


@dataclass(frozen=True)
class Generated:
    spec: CircuitSpec
    source: Literal["rules", "llm", "plan"]


class Generator:
    def __init__(self, llm: LlmPlanner | None = None) -> None:
        self.llm = llm
        self.templates = RuleBasedGenerator()

    @classmethod
    def from_settings(cls, settings: Settings) -> Generator:
        llm = None
        if settings.gemini_api_key:
            llm = LlmPlanner(
                settings.gemini_api_key, settings.gemini_model, "https://generativelanguage.googleapis.com",
                settings.llm_timeout_s, provider="gemini",
            )
        elif settings.llm_api_key and settings.llm_model:
            llm = LlmPlanner(settings.llm_api_key, settings.llm_model, settings.llm_base_url, settings.llm_timeout_s)
        return cls(llm)

    def translate(self, prompt: str) -> tuple[SystemPlan, Literal["rules", "llm"]]:
        """Read a project description into a plan, with the language model if configured."""
        if self.llm is not None:
            try:
                return self.llm.plan(prompt), "llm"
            except LlmError as exc:
                logger.warning("language model unavailable, using rules: %s", exc)
        if not wants_system(prompt):
            raise GenerationError(
                "That reads as a single circuit rather than a multi-part project. Use Build it for it, "
                "or mention joysticks, buttons, knobs, LEDs or a buzzer for a complex task."
            )
        return plan_system(prompt), "rules"

    def generate(self, prompt: str, plan: SystemPlan | None = None) -> Generated:
        if plan is not None:
            return Generated(build_system(plan), "plan")
        if wants_firmware(prompt):
            return Generated(self.templates.generate(prompt), "rules")
        if self.llm is not None:
            try:
                return Generated(build_system(self.llm.plan(prompt)), "llm")
            except LlmError as exc:
                logger.warning("language model unavailable, using rules: %s", exc)

        if wants_system(prompt):
            return Generated(build_system(plan_system(prompt)), "rules")
        return Generated(self.templates.generate(prompt), "rules")

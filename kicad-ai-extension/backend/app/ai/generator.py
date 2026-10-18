"""Choose how a prompt becomes a CircuitSpec.

Order of attempts
1. Language model (only if configured): prompt -> SystemPlan -> synthesizer.
2. Microcontroller projects by rules (joysticks, games, LEDs, buzzers, ...): prompt -> SystemPlan -> synthesizer.
3. Single-circuit templates (555 blinker, regulator, divider, filter, ...).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Literal

from app.ai.circuit_generator import RuleBasedGenerator
from app.ai.llm_planner import LlmError, LlmPlanner
from app.ai.system_designer import build_system
from app.ai.system_rules import plan_system, wants_system
from app.config import Settings
from app.schemas.circuit import CircuitSpec

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Generated:
    spec: CircuitSpec
    source: Literal["rules", "llm"]


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

    def generate(self, prompt: str) -> Generated:
        if self.llm is not None:
            try:
                return Generated(build_system(self.llm.plan(prompt)), "llm")
            except LlmError as exc:
                logger.warning("language model unavailable, using rules: %s", exc)

        if wants_system(prompt):
            return Generated(build_system(plan_system(prompt)), "rules")
        return Generated(self.templates.generate(prompt), "rules")

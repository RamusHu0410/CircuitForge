"""A lesson about one generated circuit: what the CircuitForge window's Classroom shows.

Everything in it is derived from the generated circuit (component values, nets, the
engine's own calculations, ERC results), so the class always matches what the user built.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class LevelText(BaseModel):
    """The same idea at three depths (the window's "explain" levels)."""

    eli5: str
    beginner: str
    expert: str


class Fact(BaseModel):
    label: str
    value: str


class Formula(BaseModel):
    tex: str = Field(description="LaTeX, with this circuit's numbers filled in")
    caption: str = ""


class PlayParam(BaseModel):
    name: str = Field(pattern=r"^[A-Za-z_][A-Za-z0-9_]{0,15}$", description="variable used in the output expressions")
    label: str
    tex: str
    value: float
    min: float
    max: float
    step: float
    unit: str = ""


class PlayOutput(BaseModel):
    label: str
    tex: str
    expr: str = Field(description="arithmetic over the params: + - * / ** ( ), sqrt, exp, log, PI, min, max, abs")
    unit: str = ""
    digits: int = 3
    max_ok: float | None = Field(default=None, description="above this the design breaks a limit")
    limit_note: str = ""


class Playground(BaseModel):
    """Sliders for "what if?" experiments; outputs are recomputed live by the window."""

    caption: str = ""
    params: list[PlayParam]
    outputs: list[PlayOutput]


class QuizQuestion(BaseModel):
    question: str
    options: list[str] = Field(min_length=2, max_length=5)
    answer: int = Field(ge=0, description="index into options")
    why: str


class CodeExcerpt(BaseModel):
    title: str
    start_line: int
    code: str
    explain: LevelText


class BuildStep(BaseModel):
    title: str
    key: str | None = None
    detail: str


class LessonSection(BaseModel):
    id: str
    kind: Literal["overview", "parts", "math", "code", "build", "check"]
    title: str
    refs: list[str] = []
    text: LevelText
    facts: list[Fact] = []
    formulas: list[Formula] = []
    playground: Playground | None = None
    code: list[CodeExcerpt] = []
    steps: list[BuildStep] = []
    quiz: list[QuizQuestion] = []


class Lesson(BaseModel):
    title: str
    summary: LevelText
    sections: list[LessonSection]

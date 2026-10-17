"""Component definition schemas.

A component definition is pure metadata: it describes a component's ports and
configurable parameters so the frontend can render it without executing it.
Execution logic lives separately in `app.components`.
"""

import math
from enum import StrEnum
from typing import Annotated, Self

from pydantic import BaseModel, ConfigDict, Field, FiniteFloat, StringConstraints, model_validator

# snake_case identifiers used for component types, port names and parameter names.
SnakeCaseName = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]*$", max_length=64)]

# Values a component parameter can hold.
ParameterValue = bool | int | FiniteFloat | str


class PortDataType(StrEnum):
    """Data types that flow through component ports."""

    NUMBER = "number"  # float
    BOOLEAN = "boolean"  # bool
    VECTOR2 = "vector2"  # {"x": float, "y": float}
    EVENT = "event"  # bool, True on the tick the event fires
    GAME_STATE = "game_state"  # {"status", "home_score", "away_score", "winner"}


class ComponentCategory(StrEnum):
    INPUT = "input"
    CONTROLLER = "controller"
    LOGIC = "logic"
    OUTPUT = "output"


class ParameterType(StrEnum):
    NUMBER = "number"
    INTEGER = "integer"
    BOOLEAN = "boolean"
    ENUM = "enum"


class _StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PortDefinition(_StrictModel):
    """A named, typed input or output port."""

    name: SnakeCaseName
    data_type: PortDataType
    description: str = ""
    # Inputs only: a required input must be connected for the blueprint to be valid.
    required: bool = False


class ParameterConstraint(_StrictModel):
    """Type and allowed range/options for a configurable parameter."""

    type: ParameterType
    minimum: FiniteFloat | None = None
    maximum: FiniteFloat | None = None
    options: list[str] | None = None
    description: str = ""

    @model_validator(mode="after")
    def _check_consistency(self) -> Self:
        is_numeric = self.type in (ParameterType.NUMBER, ParameterType.INTEGER)
        if not is_numeric and (self.minimum is not None or self.maximum is not None):
            raise ValueError("minimum/maximum are only allowed for number or integer parameters")
        if self.minimum is not None and self.maximum is not None and self.minimum > self.maximum:
            raise ValueError("minimum must be less than or equal to maximum")
        if self.type == ParameterType.ENUM:
            if not self.options:
                raise ValueError("enum parameters require a non-empty options list")
        elif self.options is not None:
            raise ValueError("options are only allowed for enum parameters")
        return self

    def validate_value(self, value: object) -> str | None:
        """Return an error message if `value` violates this constraint, else None."""
        # bool is a subclass of int in Python, so exclude it from numeric checks.
        if self.type == ParameterType.BOOLEAN:
            return None if isinstance(value, bool) else "must be a boolean"
        if self.type == ParameterType.ENUM:
            options = self.options or []
            return None if value in options else f"must be one of {options}"
        if self.type == ParameterType.INTEGER:
            if isinstance(value, bool) or not isinstance(value, int):
                return "must be an integer"
        elif isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            return "must be a finite number"

        if self.minimum is not None and value < self.minimum:
            return f"must be >= {self.minimum}"
        if self.maximum is not None and value > self.maximum:
            return f"must be <= {self.maximum}"
        return None


class ComponentDefinition(_StrictModel):
    """Metadata describing a component type."""

    type: SnakeCaseName
    name: str = Field(min_length=1)
    description: str
    category: ComponentCategory
    inputs: list[PortDefinition] = Field(default_factory=list)
    outputs: list[PortDefinition] = Field(default_factory=list)
    default_parameters: dict[SnakeCaseName, ParameterValue] = Field(default_factory=dict)
    parameter_constraints: dict[SnakeCaseName, ParameterConstraint] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _check_ports_and_parameters(self) -> Self:
        for label, ports in (("input", self.inputs), ("output", self.outputs)):
            names = [port.name for port in ports]
            duplicates = sorted({name for name in names if names.count(name) > 1})
            if duplicates:
                raise ValueError(f"duplicate {label} port names: {duplicates}")
        if any(port.required for port in self.outputs):
            raise ValueError("output ports cannot be marked as required")

        defaults, constraints = set(self.default_parameters), set(self.parameter_constraints)
        if defaults != constraints:
            raise ValueError(
                "default_parameters and parameter_constraints must have the same keys; "
                f"missing constraints: {sorted(defaults - constraints)}, "
                f"missing defaults: {sorted(constraints - defaults)}"
            )

        for name, value in self.default_parameters.items():
            error = self.parameter_constraints[name].validate_value(value)
            if error:
                raise ValueError(f"default for parameter '{name}' {error}")
        return self

    def input_port(self, name: str) -> PortDefinition | None:
        return next((port for port in self.inputs if port.name == name), None)

    def output_port(self, name: str) -> PortDefinition | None:
        return next((port for port in self.outputs if port.name == name), None)

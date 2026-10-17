"""Schemas shared across API endpoints."""

from collections.abc import Iterable
from enum import StrEnum
from typing import Literal, Self

from pydantic import BaseModel, model_validator


class HealthResponse(BaseModel):
    """Response body for the health check endpoint."""

    status: Literal["ok"]
    service: str
    version: str
    environment: str


class ValidationCode(StrEnum):
    """Machine-readable codes for blueprint validation issues."""

    # Errors
    EMPTY_BLUEPRINT = "EMPTY_BLUEPRINT"
    DUPLICATE_NODE_ID = "DUPLICATE_NODE_ID"
    DUPLICATE_EDGE_ID = "DUPLICATE_EDGE_ID"
    UNKNOWN_COMPONENT = "UNKNOWN_COMPONENT"
    UNKNOWN_PARAMETER = "UNKNOWN_PARAMETER"
    INVALID_PARAMETER = "INVALID_PARAMETER"
    MISSING_REQUIRED_INPUT = "MISSING_REQUIRED_INPUT"
    UNKNOWN_NODE = "UNKNOWN_NODE"
    UNKNOWN_PORT = "UNKNOWN_PORT"
    INVALID_PORT_DIRECTION = "INVALID_PORT_DIRECTION"
    INCOMPATIBLE_PORT_TYPES = "INCOMPATIBLE_PORT_TYPES"
    DUPLICATE_CONNECTION = "DUPLICATE_CONNECTION"
    MULTIPLE_INPUT_CONNECTIONS = "MULTIPLE_INPUT_CONNECTIONS"
    CYCLE_DETECTED = "CYCLE_DETECTED"
    # Warnings
    UNCONNECTED_NODE = "UNCONNECTED_NODE"
    FEEDBACK_LOOP = "FEEDBACK_LOOP"


class ValidationIssue(BaseModel):
    """A single validation error or warning.

    `node_id` / `edge_id` let the frontend highlight the offending React Flow
    node or edge. `field` names the port or parameter involved, when relevant.
    """

    code: ValidationCode
    message: str
    node_id: str | None = None
    edge_id: str | None = None
    field: str | None = None


class ValidationResult(BaseModel):
    valid: bool
    errors: list[ValidationIssue] = []
    warnings: list[ValidationIssue] = []

    @model_validator(mode="after")
    def _valid_matches_errors(self) -> Self:
        if self.valid == bool(self.errors):
            raise ValueError("valid must be true exactly when there are no errors")
        return self

    @classmethod
    def from_issues(
        cls, errors: Iterable[ValidationIssue], warnings: Iterable[ValidationIssue] = ()
    ) -> Self:
        errors = list(errors)
        return cls(valid=not errors, errors=errors, warnings=list(warnings))

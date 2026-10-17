"""Blueprint endpoints.

Validation returns HTTP 200 whenever the request is well-formed, with
`valid: false` and a list of issues for invalid designs. Malformed JSON or
wrong field types are rejected by FastAPI with HTTP 422.
"""

from fastapi import APIRouter

from app.api.dependencies import RegistryDep
from app.core.graph_validator import validate_blueprint
from app.schemas.blueprint import Blueprint
from app.schemas.common import ValidationResult

router = APIRouter(prefix="/blueprints", tags=["blueprints"])


@router.post("/validate", response_model=ValidationResult, summary="Validate a blueprint")
def validate(blueprint: Blueprint, registry: RegistryDep) -> ValidationResult:
    return validate_blueprint(blueprint, registry)

"""Component catalog endpoints (metadata only; nothing is executed)."""

from fastapi import APIRouter, HTTPException, status

from app.api.dependencies import RegistryDep
from app.core.errors import UnknownComponentError
from app.schemas.component import ComponentDefinition

router = APIRouter(prefix="/components", tags=["components"])


@router.get("", response_model=list[ComponentDefinition], summary="List all component definitions")
def list_components(registry: RegistryDep) -> list[ComponentDefinition]:
    return registry.list_definitions()


@router.get(
    "/{component_type}",
    response_model=ComponentDefinition,
    summary="Get one component definition",
    responses={status.HTTP_404_NOT_FOUND: {"description": "Unknown component type"}},
)
def get_component(component_type: str, registry: RegistryDep) -> ComponentDefinition:
    try:
        return registry.get_definition(component_type)
    except UnknownComponentError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

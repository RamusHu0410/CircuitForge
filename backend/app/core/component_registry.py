"""In-memory registry of available component types."""

from functools import lru_cache

from app.components.base import ExecuteFn, RegisteredComponent
from app.components.controllers import ball_controller, player_controller
from app.components.inputs import joystick
from app.components.logic import collision_detector, game_state_manager, score_manager
from app.components.outputs import led_controller
from app.core.errors import DuplicateComponentError, UnknownComponentError
from app.schemas.component import ComponentDefinition

BUILTIN_COMPONENT_MODULES = (
    joystick,
    player_controller,
    ball_controller,
    collision_detector,
    score_manager,
    game_state_manager,
    led_controller,
)


class ComponentRegistry:
    """Maps component type names to their definitions and execution functions."""

    def __init__(self) -> None:
        self._components: dict[str, RegisteredComponent] = {}

    def register(self, definition: ComponentDefinition, execute: ExecuteFn) -> None:
        if not isinstance(definition, ComponentDefinition):
            raise TypeError("definition must be a ComponentDefinition")
        if not callable(execute):
            raise TypeError(f"execute for component '{definition.type}' must be callable")
        if definition.type in self._components:
            raise DuplicateComponentError(definition.type)
        self._components[definition.type] = RegisteredComponent(definition=definition, execute=execute)

    def get(self, component_type: str) -> RegisteredComponent:
        try:
            return self._components[component_type]
        except KeyError:
            raise UnknownComponentError(component_type, self._components) from None

    def get_definition(self, component_type: str) -> ComponentDefinition:
        return self.get(component_type).definition

    def get_executor(self, component_type: str) -> ExecuteFn:
        return self.get(component_type).execute

    def list_definitions(self) -> list[ComponentDefinition]:
        """All definitions, in registration order."""
        return [component.definition for component in self._components.values()]

    @property
    def types(self) -> list[str]:
        return list(self._components)

    def __contains__(self, component_type: object) -> bool:
        return component_type in self._components

    def __len__(self) -> int:
        return len(self._components)


def create_default_registry() -> ComponentRegistry:
    """Build a registry containing all built-in components."""
    registry = ComponentRegistry()
    for module in BUILTIN_COMPONENT_MODULES:
        registry.register(module.DEFINITION, module.execute)
    return registry


@lru_cache
def get_component_registry() -> ComponentRegistry:
    """Shared application-wide registry."""
    return create_default_registry()

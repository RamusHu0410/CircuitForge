"""Domain errors raised by the core engine."""

from collections.abc import Iterable


class CurcuitForgeError(Exception):
    """Base class for CurcuitForge domain errors."""


class DuplicateComponentError(CurcuitForgeError):
    def __init__(self, component_type: str) -> None:
        self.component_type = component_type
        super().__init__(f"Component type '{component_type}' is already registered.")


class UnknownComponentError(CurcuitForgeError):
    def __init__(self, component_type: str, available: Iterable[str]) -> None:
        self.component_type = component_type
        self.available = sorted(available)
        super().__init__(
            f"Unknown component type '{component_type}'. "
            f"Available types: {', '.join(self.available) or 'none'}."
        )

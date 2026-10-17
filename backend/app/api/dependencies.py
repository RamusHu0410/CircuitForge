"""Shared FastAPI dependencies."""

from typing import Annotated

from fastapi import Depends

from app.config import Settings, get_settings
from app.core.component_registry import ComponentRegistry, get_component_registry

# Inject application settings into route handlers:
#   def handler(settings: SettingsDep): ...
SettingsDep = Annotated[Settings, Depends(get_settings)]

# Inject the shared component registry.
RegistryDep = Annotated[ComponentRegistry, Depends(get_component_registry)]

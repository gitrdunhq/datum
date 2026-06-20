"""Adapter registry — the plugin mechanism (ADR-0032).

A port can have many adapters; an adapter self-registers a factory under a key, and the composition
root resolves by key. Packages that hold adapters auto-import their modules, so adding an adapter is a
drop-in (open/closed) — no edits to a central dispatch.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Generic, TypeVar

T = TypeVar("T")


class Registry(Generic[T]):
    def __init__(self, name: str) -> None:
        self.name = name
        self._factories: dict[str, Callable[..., T]] = {}

    def register(self, key: str) -> Callable[[Callable[..., T]], Callable[..., T]]:
        def deco(factory: Callable[..., T]) -> Callable[..., T]:
            self._factories[key] = factory
            return factory

        return deco

    def create(self, key: str, **kwargs: object) -> T:
        try:
            factory = self._factories[key]
        except KeyError:
            raise KeyError(
                f"no {self.name} plugin registered for {key!r}; known: {self.keys()}"
            ) from None
        return factory(**kwargs)

    def keys(self) -> list[str]:
        return sorted(self._factories)


def autodiscover(package_name: str, package_path: list[str]) -> None:
    """Import every non-underscore submodule of a package so its adapters self-register on import.

    The single home for the plugin auto-discovery loop (used by each ``data/*/__init__.py``)."""
    import importlib
    import pkgutil

    for module in pkgutil.iter_modules(package_path):
        if not module.name.startswith("_"):
            importlib.import_module(f"{package_name}.{module.name}")

# Python Coding Standards

Reference for generating `ai/instructions/backend.md` in Python projects without a specific web framework (Django, FastAPI). For framework-specific standards, see `python-django.md` or `python-fastapi.md`.

## Project Structure

- Use `src/` layout for packages (`src/mypackage/`), flat layout for scripts and small projects.
- One module per concern. Avoid god modules with 500+ lines.
- `__init__.py` should be empty or re-export public API only.

## Type Hints

- Type-annotate all function signatures. Use `from __future__ import annotations` for forward references.
- Use `TypeAlias` for complex types. Prefer `X | None` over `Optional[X]` (Python 3.10+).
- Run `mypy --strict` or `pyright` in CI.

```python
# DO
def process_order(order_id: int, *, dry_run: bool = False) -> OrderResult:
    ...

# DON'T
def process_order(order_id, dry_run=False):
    ...
```

## Error Handling

- Catch specific exceptions, never bare `except:` or `except Exception:` in library code.
- Use custom exception classes for domain errors. Inherit from a project base exception.
- Let unexpected errors propagate - don't silently swallow them.

## Testing

- Use `pytest` with fixtures. Name test files `test_*.py`, test functions `test_*`.
- Use `pytest.mark.parametrize` for data-driven tests instead of loops.
- Mock at the boundary (HTTP calls, database, filesystem), not internal functions.

## Dependencies

- Pin dependencies in `requirements.txt` or `pyproject.toml` with exact versions for applications, compatible ranges for libraries.
- Use virtual environments (`venv`, `uv`, `poetry`). Never install globally.
- Separate dev dependencies from production dependencies.

## Code Style

- Follow PEP 8. Use `ruff` for linting and formatting (replaces flake8 + black + isort).
- Use `dataclasses` or `pydantic` for structured data instead of plain dicts.
- Prefer list/dict/set comprehensions over `map`/`filter` with lambdas.
- Use `pathlib.Path` over `os.path` for filesystem operations.

```python
# DO - dataclass for structured data
@dataclass
class UserConfig:
    name: str
    email: str
    active: bool = True

# DON'T - untyped dict
config = {"name": "alice", "email": "a@b.com", "active": True}
```

## Async

- Use `asyncio` for I/O-bound concurrency. Use `multiprocessing` for CPU-bound parallelism.
- Don't mix sync and async code without `asyncio.to_thread()` or `run_in_executor()`.
- Use `async with` for context managers that manage connections or sessions.

## Common Footguns

- **Mutable default arguments:** `def f(items=[])` shares the list across calls. Use `def f(items=None)` with `items = items or []`.
- **Circular imports:** Two modules importing each other at the top level. Fix with local imports or restructure.
- **`is` vs `==`:** `is` checks identity, `==` checks equality. `x is None` is correct; `x is 1` is not (small int caching is CPython-specific).
- **Silent exception swallowing:** `except: pass` hides real bugs. Catch specific exceptions.
- **f-string in logging:** `logger.info(f"User {user_id}")` evaluates the f-string even if logging level is higher. Use `logger.info("User %s", user_id)`.

## Primary Sources

- [PEP 8](https://peps.python.org/pep-0008/)
- [ruff](https://docs.astral.sh/ruff/)
- [mypy](https://mypy.readthedocs.io/)
- [pytest](https://docs.pytest.org/)

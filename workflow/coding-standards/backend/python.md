# Python Coding Standards (No Framework)

Reference for generating `ai/instructions/backend.md` in Python projects without a web framework (CLI tools, libraries, data pipelines, scripts, automation, microservices with minimal HTTP).

## Project Structure

- Use `src/` layout for libraries and packages. Flat layout for single-module scripts.
- One `__init__.py` per package. Keep it minimal — re-exports only, no logic.
- Entry points in `__main__.py` or a `cli.py` module. Use `if __name__ == '__main__'` guard.

```
project/
├── src/
│   └── mypackage/
│       ├── __init__.py
│       ├── __main__.py    # python -m mypackage
│       ├── core.py        # business logic
│       ├── models.py      # data classes
│       └── io.py          # file/network I/O
├── tests/
├── pyproject.toml
└── .env
```

## Coding Style

- Follow PEP 8. Enforce with `ruff` (preferred) or `flake8` + `black`.
- Type annotate all function signatures. Use `mypy --strict` or `pyright` for checking.
- Use `from __future__ import annotations` for modern annotation syntax in Python 3.9-.
- Max line length: 88 (Black default) or 120. Be consistent.

```python
# DO — typed, clear naming, docstring for non-obvious logic
def calculate_shipping(
    weight_kg: float,
    destination: Region,
    *,
    express: bool = False,
) -> Money:
    """Apply weight-based rate with express surcharge."""
    rate = RATES[destination]
    base = Money(cents=int(weight_kg * rate.per_kg_cents))
    return base * rate.express_multiplier if express else base

# DON'T — untyped, single-letter args, no context
def calc(w, d, e=False):
    r = RATES[d]
    return w * r.pkg * (1.5 if e else 1)
```

## Error Handling

- Raise specific exceptions. Catch at the boundary, not inside business logic.
- Create a project exception hierarchy rooted in a base class.
- Never use bare `except:` — at minimum `except Exception:`. Prefer specific types.
- Use `logging` instead of `print()` for diagnostic output.

```python
# DO — specific exception hierarchy
class AppError(Exception):
    """Base for all project exceptions."""

class NotFoundError(AppError):
    pass

class ValidationError(AppError):
    def __init__(self, field: str, message: str) -> None:
        self.field = field
        super().__init__(f"{field}: {message}")

# DON'T — bare except swallows KeyboardInterrupt and SystemExit
try:
    process(data)
except:
    pass
```

## Data Classes and Models

- Use `dataclasses` for plain data containers. Use `Pydantic` when you need validation or serialization.
- Prefer `@dataclass(frozen=True)` for immutable value objects.
- Use `TypedDict` for structured dictionaries (e.g., JSON payloads) when a full class is overkill.
- Use `Enum` for fixed sets of values, not string constants.

```python
from dataclasses import dataclass
from enum import Enum

class Status(Enum):
    PENDING = "pending"
    ACTIVE = "active"
    CLOSED = "closed"

@dataclass(frozen=True)
class Order:
    id: str
    amount_cents: int
    status: Status

# DON'T — raw dicts for structured data
order = {"id": "abc", "amount": 100, "status": "pending"}  # no type safety
```

## Database Access

- Use parameterized queries. Never f-string or format user input into SQL.
- For raw `sqlite3`/`psycopg`: use `?` (sqlite) or `%s` (psycopg2) / `$1` (psycopg3) placeholders.
- Wrap multi-step operations in transactions with context managers.

```python
# DO — parameterized query
cursor.execute("SELECT * FROM users WHERE email = %s", (email,))

# DON'T — string formatting = SQL injection
cursor.execute(f"SELECT * FROM users WHERE email = '{email}'")
```

- For projects with many queries, use SQLAlchemy Core (not the ORM) for query building without the abstraction overhead.
- Connection management: use context managers (`with conn:`) to ensure cleanup.

## Dependencies

- Use `pyproject.toml` (PEP 621) as the single source of project metadata.
- Pin dependencies with a lock file: `uv.lock` (uv), `poetry.lock` (Poetry), or `requirements.txt` with hashes.
- Separate dev dependencies: `[project.optional-dependencies]` or `[tool.poetry.group.dev]`.
- Run `pip-audit` or `safety check` in CI for known vulnerabilities.

## Testing

- Use `pytest`. Structure: `tests/` at project root, mirrors `src/` layout.
- Arrange-Act-Assert pattern. One assertion focus per test. Use descriptive names.
- Use `pytest` fixtures for setup/teardown. Prefer factory fixtures over shared mutable state.
- Mock external I/O (network, filesystem, time) at boundaries. Never mock the unit under test.

```python
# DO — focused, descriptive test
def test_shipping_express_doubles_base_rate():
    standard = calculate_shipping(2.0, Region.US, express=False)
    express = calculate_shipping(2.0, Region.US, express=True)
    assert express == standard * Decimal("1.5")

# DON'T — vague name, multiple concerns
def test_shipping():
    assert calculate_shipping(2.0, Region.US) > 0
    assert calculate_shipping(0, Region.US) == 0
    assert calculate_shipping(2.0, Region.EU) > 0
```

- Run tests: `pytest` or `python -m pytest`
- Coverage: `pytest --cov=src`
- Marker for slow tests: `@pytest.mark.slow`, run separately in CI

## CLI Tools

- Use `argparse` (stdlib) for simple CLIs, `click` or `typer` for complex ones.
- Exit codes: 0 = success, 1 = runtime error, 2 = usage error. Use `sys.exit()` only in the entry point.
- Write to stdout for data, stderr for diagnostics. This allows piping.

```python
# DO — structured CLI entry point
def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        result = process(args.input_file)
        print(result)
        return 0
    except AppError as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1

if __name__ == "__main__":
    sys.exit(main())
```

## Concurrency

- Use `asyncio` for I/O-bound work (network, file). Use `concurrent.futures.ProcessPoolExecutor` for CPU-bound.
- Never mix `asyncio` and threads unless you use `asyncio.to_thread()` (3.9+).
- For simple parallelism, `concurrent.futures.ThreadPoolExecutor` with context manager is sufficient.

```python
# DO — asyncio for I/O-bound
async def fetch_all(urls: list[str]) -> list[Response]:
    async with aiohttp.ClientSession() as session:
        tasks = [session.get(url) for url in urls]
        return await asyncio.gather(*tasks)

# DO — ProcessPoolExecutor for CPU-bound
from concurrent.futures import ProcessPoolExecutor
with ProcessPoolExecutor() as pool:
    results = list(pool.map(heavy_compute, items))
```

## Common Footguns

- **Mutable default arguments**: `def f(items=[])` shares the list across calls. Use `def f(items: list | None = None)` with `items = items or []`.
- **Late binding closures**: `[lambda: i for i in range(3)]` — all return 2. Fix: `lambda i=i: i`.
- **`is` vs `==`**: `is` checks identity, `==` checks equality. `x is None` is correct; `x is 1` is not (small int caching is an implementation detail).
- **Circular imports**: Move imports inside functions, use `TYPE_CHECKING` guard for type-only imports, or restructure modules.
- **`datetime.now()` without timezone**: Returns naive datetime. Always use `datetime.now(tz=timezone.utc)` or `datetime.now(tz=ZoneInfo("..."))`.
- **`os.path` vs `pathlib`**: Prefer `pathlib.Path` for new code. Don't mix — pick one per project.

## Primary Sources

- PEP 8 — Style Guide for Python Code
- PEP 484 — Type Hints
- Python Standard Library documentation (docs.python.org)
- mypy documentation (mypy.readthedocs.io)

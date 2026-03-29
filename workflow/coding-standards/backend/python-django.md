# Django + DRF Coding Standards

Reference for generating `ai/instructions/backend.md` in Django projects.

## App Structure

- One Django app per domain: `users/`, `orders/`, `billing/`. DO NOT create a single `api/` app for everything.
- Fat models, thin views. Business logic belongs on the model or in a service layer, not in the view.
- Service functions for complex operations that span multiple models.

## ORM

- Always use `select_related` (foreign key) and `prefetch_related` (reverse/M2M) to avoid N+1 queries.
- Use `F()` expressions for database-level operations and `Q()` objects for complex filters.
- Use `.only()` or `.defer()` when you need a subset of fields on large tables.

```python
# DO — eager load related objects
orders = Order.objects.select_related("customer").prefetch_related("items")

# DON'T — N+1: hits the DB once per order in the template loop
orders = Order.objects.all()
for order in orders:
    print(order.customer.name)  # separate query each time
```

## Views

- Class-based views for standard CRUD (CreateView, UpdateView, ListView).
- Function-based views for custom logic that doesn't map to CRUD.
- DO NOT use class-based views when the logic is a single conditional — a function is clearer.

## Django REST Framework

- Use `ModelSerializer` for straightforward models. Switch to `Serializer` for custom representations.
- Use `ViewSet` + `Router` for full CRUD endpoints. Use `APIView` for non-CRUD actions.
- Define `permission_classes` per view. Default to `IsAuthenticated`.
- Apply throttling: `AnonRateThrottle` and `UserRateThrottle` at minimum.

```python
# DO — explicit permissions and serializer
class OrderViewSet(ModelViewSet):
    queryset = Order.objects.select_related("customer")
    serializer_class = OrderSerializer
    permission_classes = [IsAuthenticated, IsOrderOwner]

# DON'T — open to all, no eager loading
class OrderViewSet(ModelViewSet):
    queryset = Order.objects.all()
    serializer_class = OrderSerializer
```

## Migrations

- Always review auto-generated migrations before committing. Django guesses rename vs. add+drop.
- Migrations MUST be reversible. Provide `RunPython` with a reverse function or `migrations.RunPython.noop`.
- DO NOT squash migrations in a branch — squash on main after merge.

## Settings

- Use `django-environ` or `environs` for environment variable parsing. Never hardcode secrets.
- Separate settings: `settings/base.py`, `settings/dev.py`, `settings/prod.py`. Import base from each.
- DO NOT read `os.environ` directly in settings — use the env parser with defaults and type casting.

```python
# DO
env = environ.Env()
SECRET_KEY = env("SECRET_KEY")
DEBUG = env.bool("DEBUG", default=False)

# DON'T
SECRET_KEY = "hardcoded-secret-key-12345"
DEBUG = True
```

## Testing

- Use `pytest-django` over Django's default test runner.
- Use `factory_boy` for test data. DO NOT use fixtures (JSON/YAML) — they rot and break on schema changes.
- Prefer `RequestFactory` for unit-testing views. Use `Client` only for integration/end-to-end tests.
- Mark database tests with `@pytest.mark.django_db`.

```python
# DO — factory + APIRequestFactory (DRF) for DRF views
from rest_framework.test import APIRequestFactory, force_authenticate
user = UserFactory(role="admin")
request = APIRequestFactory().get("/orders/")
force_authenticate(request, user=user)
response = OrderListView.as_view()(request)
assert response.status_code == 200

# DO — plain Django RequestFactory for non-DRF views
from django.test import RequestFactory
request = RequestFactory().get("/orders/")
request.user = UserFactory(role="admin")
response = OrderListView.as_view()(request)

# DON'T — full Client round-trip for a unit test (use for integration tests only)
client = Client()
client.force_login(UserFactory())
response = client.get("/orders/")
```

## Celery

- All tasks MUST be idempotent — safe to retry without side effects.
- Use `acks_late=True` so tasks re-queue if the worker crashes mid-execution.
- Implement exponential backoff for retries with a ceiling: `self.retry(countdown=min(2 ** self.request.retries, 3600))`.
- DO NOT pass Django model instances to tasks — pass IDs and re-fetch inside the task.

## Common Footguns

- **N+1 queries**: Every `.foreign_key` access in a loop is a separate query. Always check with `django-debug-toolbar` or `assertNumQueries`.
- **Raw SQL injection**: `Model.objects.raw(f"SELECT * FROM t WHERE id={user_input}")` is injectable. Use parameterized queries: `.raw("SELECT * FROM t WHERE id=%s", [user_input])`.
- **DEBUG=True in production**: Leaks full stack traces, settings, and SQL queries to users.
- **Secret key in code**: Committing `SECRET_KEY` to version control compromises session signing and CSRF tokens.
- **Unvalidated bulk_create/update**: `bulk_create` skips model validation and signals. Validate data before bulk operations.

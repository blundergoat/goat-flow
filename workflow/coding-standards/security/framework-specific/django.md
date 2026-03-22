# Django Security Standards

Reference for generating `ai/instructions/security.md` in Django projects.

## CSRF Protection

Django CSRF middleware is enabled by default. Never remove it.

```python
# DO — include CSRF token in templates
<form method="POST" action="{% url 'create_order' %}">
    {% csrf_token %}
    <button type="submit">Place Order</button>
</form>

# DON'T — exempt views without a strong reason
@csrf_exempt  # only for webhook endpoints with their own signature verification
def webhook(request):
    ...
```

- For API endpoints using DRF with session auth, the CSRF token is required. Token/JWT auth endpoints are exempt by default.
- Never add `csrf_exempt` to views that accept user input from browsers.

## ORM Injection

Standard Django ORM is safe. `extra()`, `raw()`, and `RawSQL` require care.

```python
# DO — parameterized queries
User.objects.filter(email=email)
User.objects.raw("SELECT * FROM auth_user WHERE email = %s", [email])

# DON'T — string interpolation
User.objects.raw(f"SELECT * FROM auth_user WHERE email = '{email}'")
User.objects.extra(where=[f"email = '{email}'"])  # deprecated and dangerous
```

- `extra()` is deprecated. Replace with `annotate()`, `F()`, `Value()`, and `Func()`.
- For complex queries, prefer `raw()` with parameterization over `extra()`.

## SECRET_KEY Management

- `SECRET_KEY` must be unique per environment, at least 50 characters, and cryptographically random.
- Never commit to version control. Read from environment or secret manager.
- Rotating `SECRET_KEY` invalidates all sessions and signed data.

```python
# DO — read from environment
import os
SECRET_KEY = os.environ["DJANGO_SECRET_KEY"]

# DON'T — hardcode
SECRET_KEY = "django-insecure-abc123"
```

## Production Settings

```python
# settings/production.py — MUST set all of these
DEBUG = False                    # never True in production
ALLOWED_HOSTS = ["app.example.com", "www.example.com"]  # never ["*"]
SECURE_SSL_REDIRECT = True
SECURE_HSTS_SECONDS = 63072000
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_CONTENT_TYPE_NOSNIFF = True
# SECURE_BROWSER_XSS_FILTER — removed in Django 4.0 (X-XSS-Protection is
# deprecated by browsers). Use Content-Security-Policy instead.
X_FRAME_OPTIONS = "DENY"
```

- Run `python manage.py check --deploy` to audit production settings. Fix every warning.
- `ALLOWED_HOSTS = ["*"]` in production allows host-header attacks (cache poisoning, password reset hijacking).

## Session Security

```python
# DO — secure session settings
SESSION_COOKIE_AGE = 86400              # 24-hour absolute timeout
SESSION_COOKIE_SECURE = True            # HTTPS only
SESSION_COOKIE_HTTPONLY = True           # no JavaScript access
SESSION_COOKIE_SAMESITE = "Lax"         # CSRF protection
SESSION_ENGINE = "django.contrib.sessions.backends.cache"  # or db
```

- Regenerate session key after login: `request.session.cycle_key()`.
- Invalidate sessions on password change.

## Security Audit

```bash
# Run Django's built-in security checker
python manage.py check --deploy

# Third-party scanner
pip install django-security-check
django-security-check
```

- Run `check --deploy` in CI. Fail the build on warnings.
- Use `bandit` for general Python security scanning.

## Common Footguns

- **`DEBUG = True` in production**: leaks settings (including `SECRET_KEY`), SQL queries, and full stack traces.
- **`ALLOWED_HOSTS = ["*"]`**: enables host-header injection attacks.
- **`extra()` in querysets**: deprecated, unparameterized SQL injection vector. Use ORM expressions.
- **`|safe` template filter**: marks content as safe HTML, bypassing auto-escaping. Only use with sanitized content.
- **`JsonResponse` with `safe=False`**: by default `JsonResponse` only accepts dicts. Setting `safe=False` allows serializing non-dict types (lists, strings, etc.). Ensure non-dict data is validated, as top-level JSON arrays can be exploitable in older browsers.
- **Missing `SECURE_SSL_REDIRECT`**: allows HTTP access in production. Mixed content degrades security.
- **File uploads to `MEDIA_ROOT` in app directory**: if `MEDIA_URL` is served by Django (not nginx), uploaded Python files could theoretically be imported.

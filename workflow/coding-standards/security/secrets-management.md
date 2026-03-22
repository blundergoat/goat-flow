# Secrets Management

Reference for generating `ai/instructions/security.md` in projects handling credentials, tokens, or API keys.

## Environment Variables

Environment variables are the ONLY acceptable source for secrets in application code.

```python
# DO — read from environment
import os
DATABASE_URL = os.environ["DATABASE_URL"]
API_KEY = os.environ["STRIPE_API_KEY"]

# DON'T — hardcode secrets
DATABASE_URL = "postgres://admin:s3cret@db.example.com/prod"
API_KEY = "sk_live_abc123xyz"
```

- Fail fast if a required secret is missing. Never fall back to a default value for production secrets.
- Type-check and validate secrets at startup, not at first use.

## .env Pattern

- `.env.example` — committed. Contains every variable name with placeholder values and comments.
- `.env` — gitignored. Contains real values for local development.
- Never commit `.env`. Add it to `.gitignore` before the first commit.

```bash
# .env.example (committed)
DATABASE_URL=postgres://localhost:5432/myapp_dev
STRIPE_API_KEY=sk_test_REPLACE_ME
REDIS_URL=redis://localhost:6379

# .env (gitignored, real values)
DATABASE_URL=postgres://user:real_password@db.internal:5432/myapp
STRIPE_API_KEY=sk_live_actual_key_here
REDIS_URL=redis://:auth_token@redis.internal:6379
```

```gitignore
# DO — gitignore real env files
.env
.env.local
.env.production
.env.*.local

# DON'T — gitignore the example
# .env.example   <-- this should be committed
```

## CI/CD Secrets

- Use the platform's secret management: GitHub Secrets, GitLab CI Variables, AWS SSM, HashiCorp Vault.
- Never write secrets as plaintext in workflow files, Dockerfiles, or build scripts.

```yaml
# DO — use GitHub Secrets
env:
  DATABASE_URL: ${{ secrets.DATABASE_URL }}

# DON'T — plaintext in workflow
env:
  DATABASE_URL: "postgres://admin:password@db.example.com/prod"
```

- Use OIDC federation for cloud access instead of long-lived IAM keys where possible.
- Scope CI secrets to the environments and branches that need them.

## Rotation

- Design for rotation from day one. Secrets will be compromised; recovery speed is the metric.
- Support two active keys during rotation (old + new) to avoid downtime.
- No hardcoded expiry assumptions. Read TTL from the secret store or environment.

```python
# DO — support key rotation with fallback
PRIMARY_KEY = os.environ["API_KEY"]
FALLBACK_KEY = os.environ.get("API_KEY_PREVIOUS")

def verify_request(provided_key: str) -> bool:
    if hmac.compare_digest(provided_key, PRIMARY_KEY):
        return True
    if FALLBACK_KEY and hmac.compare_digest(provided_key, FALLBACK_KEY):
        return True
    return False
```

## Logging

Never log secrets. This includes tokens, passwords, API keys, session IDs, and PII.

```python
# DO — log the action, not the credential
logger.info("API call to Stripe", extra={"merchant_id": merchant.id})

# DON'T — log the secret
logger.info(f"Calling Stripe with key {api_key}")
logger.debug(f"Request headers: {request.headers}")  # may contain Authorization
```

- Mask or redact secrets in structured logging. Use an allowlist of fields to log, not a denylist.
- Audit log output in staging to verify no secret leakage before production deploy.

## Detection

Install pre-commit hooks to catch secrets before they reach the repository.

```yaml
# .pre-commit-config.yaml
repos:
  - repo: https://github.com/awslabs/git-secrets
    rev: 1.3.0  # pin to immutable tag or SHA, not a branch ref
    hooks:
      - id: git-secrets

  # Alternative: trufflehog
  - repo: https://github.com/trufflesecurity/trufflehog
    rev: v3.63.0  # pin to immutable tag or SHA, not a branch ref
    hooks:
      - id: trufflehog
```

- Run `trufflehog` or `gitleaks` in CI as a backup for developers who skip pre-commit hooks.
- If a secret is committed: rotate immediately, then rewrite history with `git filter-repo`.

## Common Footguns

- **Secrets in docker-compose.yml**: use `env_file` or Docker secrets, not inline `environment:` values.
- **Secrets in error messages**: catch exceptions before they serialize credentials into stack traces.
- **Secrets in URLs**: `https://api.example.com?key=abc123` gets logged by proxies, browsers, and CDNs. Use headers.
- **Secrets in build args**: Docker `ARG` values are visible in image history. Use multi-stage builds and runtime env vars.
- **Shared `.env` files**: each developer should have their own local `.env`. Never share over Slack/email.
- **Default secrets in development**: even dev secrets like `password123` train bad habits. Use unique generated values.

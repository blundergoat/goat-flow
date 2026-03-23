# Infrastructure Security

Reference for generating `ai/instructions/security.md` in projects with Docker, CI pipelines, or cloud infrastructure.

## Docker

- Run as non-root user. Define `USER` after installing packages.
- Use multi-stage builds to keep build tools out of production images.
- Never pass secrets via `ARG` or `ENV` — they are visible in image history.
- Maintain a `.dockerignore` to exclude `.env`, `.git`, `node_modules`, and other sensitive/unnecessary files.

```dockerfile
# DO — non-root user, multi-stage build
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .

FROM node:20-slim
WORKDIR /app
RUN addgroup --system app && adduser --system --ingroup app app
COPY --from=build /app .
USER app
EXPOSE 3000
CMD ["node", "server.js"]

# DON'T — root user, secrets in build args
FROM node:20
ARG DATABASE_URL
ENV DATABASE_URL=$DATABASE_URL
COPY . .
RUN npm install
CMD ["node", "server.js"]
```

```dockerignore
# .dockerignore — always include
.env
.env.*
.git
node_modules
*.md
tests/
.github/
```

- Pin base image tags to digest for reproducible builds: `node:20-slim@sha256:abc123...`.
- Scan images with `trivy`, `grype`, or `docker scout` in CI.

## CI Pipeline Security

- Use least-privilege tokens. CI should not have admin access to production.
- Pin GitHub Action versions to full commit SHA.
- Prefer OIDC federation over long-lived cloud credentials.

```yaml
# DO — OIDC for AWS access, pinned actions
permissions:
  id-token: write
  contents: read

steps:
  - uses: aws-actions/configure-aws-credentials@e3dd6a429d7300a6a4c196c26e071d42e0343502  # v4.0.2
    with:
      role-to-assume: arn:aws:iam::123456789:role/ci-deploy
      aws-region: us-east-1

# DON'T — long-lived keys, unpinned actions
steps:
  - uses: aws-actions/configure-aws-credentials@v4
    with:
      aws-access-key-id: ${{ secrets.AWS_KEY }}
      aws-secret-access-key: ${{ secrets.AWS_SECRET }}
```

- Restrict secrets to specific environments and branches (`production` environment only on `main` branch).
- Run `trivy` / `gitleaks` as CI steps before deploy.

## Network Security

- Internal services (databases, caches, queues) must not be exposed to the public internet.
- TLS everywhere — including internal service-to-service communication.
- No self-signed certificates in production. Use Let's Encrypt or a managed certificate service.

```yaml
# DO — internal-only database (docker-compose)
services:
  db:
    image: postgres:16
    expose:
      - "5432"      # only accessible within Docker network
    networks:
      - internal

# DON'T — expose database to host
services:
  db:
    image: postgres:16
    ports:
      - "5432:5432"  # accessible from outside
```

- Use network policies (Kubernetes NetworkPolicy, security groups, firewall rules) to restrict traffic between services.
- Terminate TLS at the load balancer or reverse proxy. Forward to backend over private network.

## Permissions (Least Privilege)

- IAM roles and service accounts should have the minimum permissions required for their function.
- Separate roles for CI (deploy), application (runtime), and admin (manual operations).
- Audit permissions quarterly. Remove unused permissions.

```json
// DO — scoped IAM policy
{
  "Effect": "Allow",
  "Action": ["s3:GetObject", "s3:PutObject"],
  "Resource": "arn:aws:s3:::my-app-uploads/*"
}

// DON'T — overly broad permissions
{
  "Effect": "Allow",
  "Action": "s3:*",
  "Resource": "*"
}
```

## Logging

- Use structured logging (JSON format) for machine parsing and alerting.
- Never log secrets, tokens, passwords, API keys, session IDs, or PII.
- Centralize logs (ELK, CloudWatch, Datadog). Set retention policies (90 days minimum for security events).
- Log all authentication events, authorization failures, and admin actions.

```python
# DO — structured logging, no secrets
import structlog
logger = structlog.get_logger()

logger.info("user_login", user_id=user.id, ip=request.remote_addr, method="password")
logger.warning("auth_failure", user_id=user.id, ip=request.remote_addr, reason="invalid_password")

# DON'T — unstructured logging with secrets
logger.info(f"User {user.email} logged in with password {password}")
logger.debug(f"Headers: {dict(request.headers)}")  # leaks Authorization header
```

## Common Footguns

- **Root containers**: compromised container = root on the host (without proper isolation). Always `USER nonroot`.
- **Secrets in image layers**: `docker history` reveals `ARG` and `ENV` values. Use runtime env vars or mounted secrets.
- **Unpinned base images**: `node:20` resolves to a different image over time. Pin to digest for reproducibility.
- **Exposed debug ports**: leaving port 5432, 6379, 9200 open to the internet. Use `expose`, not `ports`.
- **CI admin tokens**: a compromised CI job with admin access can delete infrastructure. Scope to deploy-only.
- **Missing log retention**: logs deleted after 7 days means you cannot investigate a breach discovered on day 8.

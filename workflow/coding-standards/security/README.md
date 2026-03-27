# Security Stack Detection

Agents: load `web-common.md` for ALL web projects. Then load the framework-specific file based on detection. Load additional files based on what the project does. Some overlays, such as Cypress, are additive test-stack overlays and should be loaded alongside the main app framework file, not instead of it.

## Always Load
- web-common.md — OWASP Top 10, headers, cookie security

## Load If Detected

| Signal | Additional file |
|--------|----------------|
| File upload routes/handlers | file-upload.md |
| JWT/OAuth libraries in deps | api-auth.md |
| SQL/ORM usage | sql-injection.md |
| .env files, vault config | secrets-management.md |
| Dockerfile, CI workflows | infrastructure.md |
| Any project with dependencies | supply-chain.md |

## Framework-Specific

| Signal | Stack file |
|--------|-----------|
| composer.json + "laravel/framework" | framework-specific/laravel.md |
| pyproject.toml + "django" | framework-specific/django.md |
| Gemfile + "rails" | framework-specific/rails.md |
| pom.xml/build.gradle + "spring-boot" | framework-specific/spring.md |
| package.json + "express" | framework-specific/express-node.md |
| *.csproj + "Microsoft.AspNetCore" | framework-specific/dotnet.md |
| package.json + "cypress" | framework-specific/cypress.md |

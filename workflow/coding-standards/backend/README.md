# Backend Stack Detection

Agents: read this file to identify the backend stack, then load the matching file as a reference when generating `ai/instructions/backend.md`.

**Boundary with conventions.md:** backend.md covers language-specific architecture
and patterns (service layers, ORM patterns, error handling idioms). Cross-language
concerns (build commands, naming patterns, DO/DON'T rules) go in conventions.md.

**Selection rules:**
- Framework-specific rows beat generic language rows.
- Rows marked "oriented" or "fallback" are not copy-paste defaults. Keep only the
  sections that match the repo's actual framework, ORM, and runtime shape.
- `bash.md` is additive and should only be loaded when shell is a primary
  implementation surface, not just because a repo has a few maintenance scripts.

## Detection Signals

| Signal | Stack file |
|--------|-----------|
| go.mod | go.md |
| pyproject.toml/requirements.txt + "django" | python-django.md |
| pyproject.toml/requirements.txt + "fastapi" | python-fastapi.md |
| pyproject.toml/requirements.txt + "flask" | python.md (Flask projects: use python.md, add Flask-specific conventions manually) |
| pyproject.toml/requirements.txt (no django/fastapi/flask) | python.md |
| composer.json + "laravel/framework" | php-laravel.md |
| composer.json + "symfony/framework-bundle" | php-symfony.md |
| composer.json (no laravel/symfony) | php.md (best fit for custom/legacy PHP apps; libraries/plugins/themes must keep only applicable sections) |
| Cargo.toml | rust.md (Tokio + HTTP + SQLx oriented; adapt if the repo uses Diesel, SeaORM, or framework-specific patterns) |
| build.gradle/pom.xml + "spring-boot" | java-spring.md (Spring Boot + JPA oriented; replace only the data layer guidance if the repo uses jOOQ/MyBatis/JdbcTemplate) |
| Gemfile + "rails" | ruby-rails.md |
| package.json + "express"/"fastify"/"nest" | typescript-node.md (Express/Fastify oriented; Nest projects should adapt request pipeline guidance to modules/guards/pipes/filters) |
| *.csproj + "Microsoft.AspNetCore" | csharp-dotnet.md (ASP.NET Core + EF Core oriented; keep only the sections matching the repo's architecture and data layer) |
| *.sh files as a primary implementation/runtime surface | bash.md |

## Support Status

| Stack | Status | Notes |
|--------|--------|-------|
| Go | Supported | General Go application/service baseline |
| Python (generic) | Supported | CLI/library/script baseline |
| Django | Supported | Django + DRF-specific |
| FastAPI | Supported | FastAPI + SQLAlchemy-specific |
| Flask | Fallback | Start from `python.md`, add observed Flask conventions manually |
| PHP (generic) | Partial | Best for custom/legacy PHP web apps; do not copy web/session sections into libraries/plugins/themes |
| Laravel | Supported | Laravel + Eloquent-specific |
| Symfony | Supported | Symfony + Doctrine-specific |
| Spring Boot | Partial | Spring Boot + JPA/Spring Data-oriented |
| Rails | Supported | Rails + ActiveRecord-specific |
| TypeScript Node | Partial | Express/Fastify-oriented; adapt for Nest |
| .NET | Partial | ASP.NET Core + EF Core-oriented |
| Rust | Partial | Tokio + HTTP + SQLx-oriented |
| Bash | Conditional | Use only when shell is a dominant implementation surface |

## Multiple backends

Monorepos may have multiple backend services. Generate separate sections per service or a unified backend.md with clear boundaries.

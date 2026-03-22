# Backend Stack Detection

Agents: read this file to identify the backend stack, then load the matching file as a reference when generating `ai/instructions/backend.md`.

## Detection Signals

| Signal | Stack file |
|--------|-----------|
| go.mod | go.md |
| pyproject.toml/requirements.txt + "django" | python-django.md |
| pyproject.toml/requirements.txt + "fastapi" | python-fastapi.md |
| composer.json + "laravel/framework" | php-laravel.md |
| composer.json + "symfony/framework-bundle" | php-symfony.md |
| Cargo.toml | rust.md |
| build.gradle/pom.xml + "spring-boot" | java-spring.md |
| Gemfile + "rails" | ruby-rails.md |
| package.json + "express"/"fastify"/"nest" | typescript-node.md |
| *.csproj + "Microsoft.AspNetCore" | csharp-dotnet.md |
| *.sh files in scripts/ or project root, shebang lines | bash.md |

## Multiple backends

Monorepos may have multiple backend services. Generate separate sections per service or a unified backend.md with clear boundaries.

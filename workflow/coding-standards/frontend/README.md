# Frontend Stack Detection

Agents: read this file to identify the frontend stack, then load the matching file as a reference when generating `ai/instructions/frontend.md`.

**Boundary with conventions.md:** `frontend.md` covers framework, rendering, and
UI-testing patterns. Cross-language rules (naming, build hygiene, generic
DO/DON'T guidance) stay in `conventions.md`.

## Detection Signals

| Signal | Stack file |
|--------|-----------|
| package.json + "react" in deps | react.md |
| package.json + "vue" in deps | vue.md |
| package.json + "@angular/core" in deps | angular.md |
| composer.json + "laravel/framework" + resources/views/*.blade.php | php-blade.md |
| composer.json + "symfony/twig-bundle" | php-twig.md |
| Gemfile + "rails" + app/views/**/*.erb | ruby-erb.md |
| requirements.txt/pyproject.toml + "django"/"flask"/"jinja2" | python-jinja.md |
| *.xcodeproj or Package.swift with SwiftUI imports | swift-ios.md |
| *.csproj + "Microsoft.AspNetCore.Components" | dotnet-blazor.md |
| package.json + "typescript" in devDeps (no React/Vue/Angular) | typescript.md |

## Framework-First Naming

The React, Vue, and Angular templates are named by framework because detection
is framework-based, not TypeScript-based. These three files are still
TypeScript-first references: if the project is JavaScript-only, keep the same
component, state, testing, and rendering rules, and drop the TS-specific syntax.

## Multiple frontends

If a project has both a React SPA and server-rendered templates (e.g., Laravel Blade for admin + React for customer portal), generate TWO sections in frontend.md or split into frontend-spa.md and frontend-templates.md.

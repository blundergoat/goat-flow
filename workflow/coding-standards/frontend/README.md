# Frontend Stack Detection

Agents: read this file to identify the frontend stack, then load the matching file as a reference when generating `ai/instructions/frontend.md`.

**Boundary with conventions.md:** `frontend.md` covers framework, rendering, and
UI-testing patterns. Cross-language rules (naming, build hygiene, generic
DO/DON'T guidance) stay in `conventions.md`.

## Detection Signals

| Signal | Stack file | Routing | Notes |
|--------|-----------|---------|-------|
| package.json + "react" in deps | react.md | auto | Add framework-specific data/loading guidance only if the repo actually uses Next/Remix/Router data APIs |
| package.json + "vue" in deps | vue.md | auto | Vue 3 / Composition API first |
| package.json + "@angular/core" in deps | angular.md | auto | Version-gated: verify standalone/signals/control-flow support from package.json |
| composer.json + "laravel/framework" + resources/views/*.blade.php | php-blade.md | auto | Livewire guidance is conditional — include only if present |
| composer.json + "symfony/twig-bundle" | php-twig.md | auto | Encore/AssetMapper/Turbo sections are conditional |
| Gemfile + "rails" + app/views/**/*.erb | ruby-erb.md | auto | Hotwire/ViewComponent guidance is conditional |
| requirements.txt/pyproject.toml + "django" | python-jinja.md | auto | Keep Django-specific sections only; do not mix Flask guidance into generated output |
| requirements.txt/pyproject.toml + "flask"/"jinja2" | python-jinja.md | auto | Keep Flask/Jinja-specific sections only; do not mix Django tags into generated output |
| *.xcodeproj or Package.swift with SwiftUI imports | swift-ios.md | auto | File now includes a UIKit appendix; only include UIKit guidance if the repo uses UIKit |
| *.csproj + "Microsoft.AspNetCore.Components" | dotnet-blazor.md | auto | Version-gated: render-mode guidance depends on .NET 8+ |
| package.json + "typescript" in devDeps (no React/Vue/Angular) | typescript.md | auto (fallback) | Framework-agnostic TypeScript; selected when TS/JS detected but no framework matched |

**Routing key:** `auto` = CLI scanner detects the signal and routes to the template automatically via `FRONTEND_TEMPLATE_MAP` in `src/cli/prompt/template-refs.ts`. All listed stacks are auto-detected; there are no manual-only entries at this time.

## Framework-First Naming

The React, Vue, and Angular templates are named by framework because detection
is framework-based, not TypeScript-based. These three files are still
TypeScript-first references: if the project is JavaScript-only, keep the same
component, state, testing, and rendering rules, and drop the TS-specific syntax.

For combined or shared-file cases such as Python templates and iOS, generate
only the branch that matches the detected framework. Do not paste mutually
exclusive Django/Flask or SwiftUI/UIKit guidance into the same `frontend.md`
unless the repo genuinely mixes both.

## Multiple frontends

If a project has both a React SPA and server-rendered templates (e.g., Laravel Blade for admin + React for customer portal), generate TWO sections in frontend.md or split into frontend-spa.md and frontend-templates.md.

# Frontend Stack Detection

Agents: read this file to identify the frontend stack, then load the matching file as a reference when generating `ai/instructions/frontend.md`.

## Detection Signals

| Signal | Stack file |
|--------|-----------|
| package.json + "react" in deps | typescript-react.md |
| package.json + "vue" in deps | typescript-vue.md |
| package.json + "@angular/core" in deps | typescript-angular.md |
| package.json + "svelte" in deps | typescript-svelte.md |
| package.json + "react-native" in deps | react-native.md |
| pubspec.yaml | flutter.md |
| composer.json + "laravel/framework" + resources/views/*.blade.php | php-blade.md |
| composer.json + "symfony/twig-bundle" | php-twig.md |
| Gemfile + "rails" + app/views/**/*.erb | ruby-erb.md |
| requirements.txt/pyproject.toml + "django"/"flask"/"jinja2" | python-jinja.md |
| *.xcodeproj or Package.swift with SwiftUI imports | swift-ios.md |
| build.gradle + "compose" in deps | kotlin-android.md |
| *.csproj + "Microsoft.AspNetCore.Components" | dotnet-blazor.md |
| package.json + "typescript" in devDeps (no React/Vue/Angular/Svelte) | typescript.md |

## Multiple frontends

If a project has both a React SPA and server-rendered templates (e.g., Laravel Blade for admin + React for customer portal), generate TWO sections in frontend.md or split into frontend-spa.md and frontend-templates.md.

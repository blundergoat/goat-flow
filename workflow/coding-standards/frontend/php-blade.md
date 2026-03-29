# PHP + Laravel Blade Coding Standards

Reference for generating `ai/instructions/frontend.md` in Laravel projects using Blade templates.

## Component-Based Blade

- Use anonymous Blade components (`x-` prefix) over `@include` for reusable UI.
- Components live in `resources/views/components/`. File name maps to tag: `alert.blade.php` = `<x-alert />`.
- Use `{{ $slot }}` for content projection, `{{ $attributes }}` for attribute forwarding.
- When interoperating with Alpine, Vue, or other colon-prefixed attributes, use
  `::attribute` so Blade does not treat the binding as PHP.

```blade
{{-- DO — component with typed props --}}
{{-- resources/views/components/button.blade.php --}}
@props(['variant' => 'primary', 'size' => 'md'])

<button {{ $attributes->merge(['class' => "btn btn-{$variant} btn-{$size}"]) }}>
    {{ $slot }}
</button>

{{-- Usage --}}
<x-button variant="danger" wire:click="delete">Delete</x-button>

{{-- DON'T — @include with loose variables --}}
@include('partials.button', ['text' => 'Delete', 'class' => 'btn-danger'])
```

## Escaping and XSS

- `{{ $variable }}` auto-escapes output. Use it by default for ALL user-provided data.
- `{!! $variable !!}` outputs raw HTML. Only use for trusted, sanitized content (e.g., CMS output run through `HTMLPurifier`).
- DO NOT use `{!! !!}` with user input. Ever.

```blade
{{-- DO --}}
<p>{{ $user->bio }}</p>

{{-- DON'T — XSS vulnerability --}}
<p>{!! $user->bio !!}</p>

{{-- OK — sanitized content --}}
<p>{!! clean($article->body) !!}</p>
```

## Layouts

- Use component-based layouts for new projects: `<x-layouts.app>`.
- `@extends`/`@section`/`@yield` for existing projects that already use them. Do not mix both patterns in the same project.

```blade
{{-- DO — component layout --}}
<x-layouts.app title="Dashboard">
    <h1>Dashboard</h1>
    {{ $slot }}
</x-layouts.app>

{{-- LEGACY — @extends layout (acceptable in existing codebases) --}}
@extends('layouts.app')
@section('content')
    <h1>Dashboard</h1>
@endsection
```

## Livewire Patterns (if present)

- Livewire components for interactive UI that would otherwise need a JS framework.
- Keep Livewire component classes thin — delegate business logic to actions/services.
- Use `wire:model.blur` for form-style validation, or a debounced
  `wire:model.live` only when the UX truly needs live feedback such as search.
- Avoid Livewire for static pages or simple forms — a standard form POST is simpler.

```blade
{{-- DO — debounced search --}}
<input type="text" wire:model.live.debounce.300ms="search" />

{{-- DON'T — real-time binding with no debounce --}}
<input type="text" wire:model.live="search" />
```

## Directives

- Use `@auth`, `@guest`, `@can` for authorization in views. Do not duplicate policy checks in Blade with raw PHP.
- Use `@forelse` over `@foreach` when the collection might be empty — it gives you the `@empty` block.
- Keep Blade logic minimal. If a conditional is complex, move it to a computed property on the model, a view composer, or a component class.

```blade
{{-- DO --}}
@forelse($users as $user)
    <x-user-card :user="$user" />
@empty
    <p>No users found.</p>
@endforelse

{{-- DON'T — complex logic in Blade --}}
@if(count($users) > 0 && $currentUser->hasRole('admin') && !$isArchived)
```

## Common Footguns

- **N+1 queries in views**: Accessing `$user->posts` in a `@foreach` triggers a query per iteration. Eager load in the controller: `User::with('posts')->get()`.
- **Unescaped output**: `{!! !!}` is the #1 XSS vector in Blade apps. Audit every usage. Grep for `{!!` regularly.
- **Massive view files**: Blade files over 200 lines are a sign to extract components. A view should compose components, not contain all the HTML.
- **Missing @csrf**: Every `<form>` with POST/PUT/DELETE needs `@csrf`. Without it, the request returns 419. Livewire handles this automatically.
- **Blade caching**: `php artisan view:clear` after template changes in production. Cached views ignore file modifications.

## Primary Sources

- [Blade Templates — Laravel docs](https://laravel.com/docs/blade)
- [Blade Components — Laravel docs](https://laravel.com/docs/blade#components)
- [Livewire — Official docs](https://livewire.laravel.com/docs)
- [Laravel Security — XSS Prevention](https://laravel.com/docs/strings#html-string)

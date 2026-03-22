# PHP + Symfony Twig Coding Standards

Reference for generating `ai/instructions/frontend.md` in Symfony projects using Twig templates.

## Template Inheritance

- Use `extends` + `block` for page layouts. Every page template extends a base layout.
- Use `include` for small, reusable fragments. Use `embed` when you need to override blocks in an included template.
- Keep the inheritance chain shallow: base layout -> section layout -> page. Three levels max.

```twig
{# DO — base layout #}
{# templates/base.html.twig #}
<!DOCTYPE html>
<html>
<head><title>{% block title %}Default{% endblock %}</title></head>
<body>
  {% block body %}{% endblock %}
  {% block javascripts %}{% endblock %}
</body>
</html>

{# DO — page template #}
{# templates/user/list.html.twig #}
{% extends 'base.html.twig' %}

{% block title %}Users{% endblock %}

{% block body %}
  <h1>Users</h1>
  {% for user in users %}
    {% include 'user/_card.html.twig' with { user: user } only %}
  {% endfor %}
{% endblock %}
```

- Use the `only` keyword with `include` to isolate the fragment's scope. Without it, the included template inherits all parent variables, creating hidden dependencies.

## Escaping and XSS

- Twig auto-escapes all output in `{{ }}`. This is your default safety net.
- The `raw` filter disables escaping. Only use it for trusted, sanitized HTML.
- DO NOT use `raw` with user input.

```twig
{# DO — auto-escaped #}
<p>{{ user.bio }}</p>

{# DON'T — XSS risk #}
<p>{{ user.bio|raw }}</p>

{# OK — explicitly sanitized content #}
<p>{{ article.body|sanitize_html|raw }}</p>
```

## Twig Extensions

- Write custom Twig extensions for reusable formatting logic. Do not repeat complex filters inline.
- Filters for data transformation: `|format_price`, `|time_ago`.
- Functions for generating content: `asset_url()`, `user_avatar()`.
- Tests for boolean checks: `is active`, `is expired`.

```php
// DO — custom filter in a Twig extension
public function getFilters(): array
{
    return [
        new TwigFilter('format_price', [$this, 'formatPrice']),
    ];
}

public function formatPrice(int $cents, string $currency = 'USD'): string
{
    return number_format($cents / 100, 2) . ' ' . $currency;
}
```

```twig
{# Usage #}
<span>{{ product.price|format_price }}</span>
```

## Form Rendering

- Use the Symfony form component. Render with `form_row()` for standard fields, or `form_widget()` + `form_label()` + `form_errors()` for custom layouts.
- Customize form themes at the project level in `config/packages/twig.yaml`, not inline per form.
- DO NOT manually build `<form>` tags with `<input>` elements for forms managed by Symfony's form system. You lose validation, CSRF protection, and data transformation.

```twig
{# DO — Symfony form rendering #}
{{ form_start(form) }}
  {{ form_row(form.name) }}
  {{ form_row(form.email) }}
  <button type="submit">Save</button>
{{ form_end(form) }}

{# DON'T — raw HTML for Symfony-managed forms #}
<form method="post">
  <input name="name" value="{{ user.name }}">
</form>
```

## Asset Management

- **Webpack Encore**: Use for projects needing JS bundling, CSS preprocessing, or complex asset pipelines.
- **AssetMapper**: Use for simpler setups (CSS + minimal JS). No build step required.
- Reference assets with `{{ asset('path') }}` or `{{ encore_entry_link_tags('app') }}`. Never hardcode `/build/` paths.

## Stimulus / Turbo (if present)

- Use Stimulus controllers for interactive behavior. One controller per concern.
- Use Turbo Frames for partial page updates, Turbo Streams for server-pushed updates.
- Keep Stimulus controllers small. If one exceeds ~80 lines, split it.

## Common Footguns

- **`raw` filter XSS**: Every `|raw` usage is a potential XSS hole. Audit on every review. Use a custom `|sanitize` filter that runs HTMLPurifier before `|raw`.
- **Missing CSRF tokens**: Manually built forms skip CSRF protection. Always use `{{ csrf_token('intention') }}` or the Symfony form system.
- **N+1 in templates**: Accessing `user.orders` in a loop triggers a query per iteration. Eager fetch in the controller or repository.
- **Over-nested inheritance**: Templates extending templates extending templates. Debug becomes impossible. Max 3 levels.
- **Global variables leaking**: Without `only` on `include`, fragments depend on parent scope. This breaks when you move the fragment to a different page.
- **Translation key drift**: Using `{{ 'label'|trans }}` with keys that do not exist in translation files fails silently. Validate translation keys in CI.

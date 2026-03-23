# Python + Jinja2/Django Templates Coding Standards

Reference for generating `ai/instructions/frontend.md` in Flask/Django projects with server-rendered templates.

## Jinja2 Autoescaping

- Autoescaping MUST be enabled globally. Verify in Flask config or Jinja2 environment setup.
- `{{ variable }}` auto-escapes. The `|safe` filter and `{% autoescape false %}` disable it.
- DO NOT use `|safe` on user-provided data. Ever.

```jinja2
{# DO — auto-escaped by default #}
<p>{{ user.bio }}</p>

{# DON'T — XSS vulnerability #}
<p>{{ user.bio|safe }}</p>

{# OK — trusted, sanitized content #}
<p>{{ article.sanitized_body|safe }}</p>
```

## Template Inheritance

- Use `{% extends %}` + `{% block %}` for layouts. Same pattern for both Flask and Django.
- Keep inheritance to 2-3 levels: base -> section layout -> page.
- Use `{{ super() }}` (Jinja2) or `{{ block.super }}` (Django) to extend a parent block rather than replacing it entirely.

```jinja2
{# base.html #}
<!DOCTYPE html>
<html>
<head>{% block head %}<title>{% block title %}{% endblock %}</title>{% endblock %}</head>
<body>{% block content %}{% endblock %}</body>
</html>

{# page.html #}
{% extends "base.html" %}
{% block title %}Users{% endblock %}
{% block content %}
  <h1>Users</h1>
  {% for user in users %}
    {% include "partials/_user_card.html" %}
  {% endfor %}
{% endblock %}
```

## Django-Specific

- **Template tags**: Write custom template tags for complex logic. Simple display logic only in templates.
- **Context processors**: Use for global data (current user, site settings). Do not overload them — each adds overhead to every request.
- Use `{% url 'name' %}` for URL generation. Never hardcode paths.
- Use `{% csrf_token %}` in every POST form. Django rejects POST requests without it.

```html
{# DO #}
<form method="post" action="{% url 'user_update' user.pk %}">
  {% csrf_token %}
  {{ form.as_div }}
  <button type="submit">Save</button>
</form>

{# DON'T — hardcoded URL, missing CSRF #}
<form method="post" action="/users/{{ user.pk }}/update/">
```

## Flask-Specific

- **Macros**: Use Jinja2 macros for reusable template fragments (form fields, cards, pagination).
- **Blueprint templates**: Organize templates by blueprint: `templates/auth/login.html`, `templates/admin/dashboard.html`.
- Use `url_for('blueprint.view')` for URL generation. Never hardcode routes.

```jinja2
{# macros/forms.html #}
{% macro form_field(field) %}
  <div class="field{% if field.errors %} has-error{% endif %}">
    {{ field.label }}
    {{ field() }}
    {% for error in field.errors %}
      <span class="error">{{ error }}</span>
    {% endfor %}
  </div>
{% endmacro %}

{# Usage #}
{% from "macros/forms.html" import form_field %}
{{ form_field(form.email) }}
```

## Common Footguns

- **SSTI (Server-Side Template Injection)**: Never construct templates from user input. `Template(user_string).render()` is a remote code execution vulnerability. Always use pre-written template files.
- **Missing CSRF protection**: Django: `{% csrf_token %}` in forms. Flask: use `flask-wtf` and `{{ form.hidden_tag() }}`.
- **`|safe` filter abuse**: Every `|safe` usage must be justified and the content must be sanitized before marking safe. Grep for `|safe` in code reviews.
- **N+1 queries in templates**: Accessing `{{ user.orders.all }}` in a loop. Use `select_related`/`prefetch_related` (Django) or eager loading in the query (Flask/SQLAlchemy).
- **Template logic creep**: If a template has more than 2-3 conditionals or loops, extract the logic into the view/context or a custom tag/macro.

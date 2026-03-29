# Ruby + Rails ERB Coding Standards

Reference for generating `ai/instructions/frontend.md` in Rails projects using ERB templates.

## Template Format

- ERB is the Rails default. If the project uses Haml or Slim, follow its conventions — project consistency wins.
- `<%= expression %>` outputs and escapes. `<% statement %>` executes without output.
- DO NOT use `<%== expression %>` (which is `raw`) on user input.

```erb
<%# DO — escaped output %>
<p><%= @user.bio %></p>

<%# DON'T — raw output of user data %>
<p><%= raw @user.bio %></p>
<p><%== @user.bio %></p>

<%# OK — sanitized content %>
<p><%= sanitize @article.body, tags: %w[p br strong em] %></p>
```

## Partials

- Extract a partial when the same HTML appears in 2+ views, or when a section exceeds ~40 lines.
- Pass data via `locals:`, not instance variables. Partials using instance variables are invisible dependencies.
- Name partials with a leading underscore: `_user_card.html.erb`.

```erb
<%# DO — explicit locals %>
<%= render 'users/user_card', user: @user, show_actions: true %>

<%# DON'T — relying on instance variables in partials %>
<%= render 'users/user_card' %>
<%# _user_card.html.erb accesses @user — where does it come from? %>
```

- Use `render collection:` for lists. Rails automatically batches rendering and avoids N+1 partial lookups.

```erb
<%# DO — collection rendering %>
<%= render partial: 'users/user_card', collection: @users, as: :user %>

<%# DON'T — manual loop %>
<% @users.each do |user| %>
  <%= render 'users/user_card', user: user %>
<% end %>
```

## ViewComponents (if present)

- Use ViewComponents for complex UI logic that does not belong in a partial or helper.
- Each ViewComponent is a Ruby class + template. Logic in the class, markup in the template.
- Test ViewComponents with unit tests — they render without a full request cycle.

```ruby
# DO — ViewComponent for complex UI
# app/components/user_badge_component.rb
class UserBadgeComponent < ViewComponent::Base
  def initialize(user:)
    @user = user
  end

  def badge_class
    @user.admin? ? 'badge-admin' : 'badge-user'
  end
end
```

```erb
<%# app/components/user_badge_component.html.erb %>
<span class="badge <%= badge_class %>"><%= @user.name %></span>

<%# Usage %>
<%= render UserBadgeComponent.new(user: @user) %>
```

## Hotwire (Turbo + Stimulus)

- If the repo is Hotwire-first, prefer **Turbo Frames** for partial page
  updates, **Turbo Streams** for server-pushed DOM updates, and **Stimulus**
  for lightweight client-side behavior.
- In hybrid apps that already use React or Vue for a defined UI boundary,
  follow that established boundary. Do not force Hotwire into an existing SPA
  island or introduce React/Vue just to replace well-working Hotwire flows.
- Keep Stimulus controllers focused. One controller per concern is a good
  default, but follow the repo's established composition pattern if it already
  groups small behaviors together.

```erb
<%# DO — Turbo Frame for inline editing %>
<turbo-frame id="<%= dom_id(@user) %>">
  <p><%= @user.name %></p>
  <%= link_to "Edit", edit_user_path(@user) %>
</turbo-frame>
```

## Helpers

- Use view helpers for simple formatting: `time_ago_in_words`, `number_to_currency`.
- Custom helpers for project-specific formatting. Keep them pure (no side effects, no database calls).
- If a helper needs more than 10 lines of logic, it belongs in a ViewComponent or presenter.

## Common Footguns

- **`html_safe` / `raw` XSS**: Marking user input as `html_safe` is a direct XSS vulnerability. Use `sanitize` with an explicit allow list instead.
- **N+1 queries in views**: Accessing `user.posts` in an `each` loop. Use `includes` or `preload` in the controller query.
- **Fat views**: Views with business logic (conditionals checking roles, computing values). Move to the model, a presenter, or a ViewComponent.
- **Missing authenticity token**: Forms built without `form_with` or `form_tag` skip CSRF protection. Always use Rails form helpers.
- **Instance variable leaks**: Controllers setting 5+ instance variables for a single view. Use a view model or locals hash to make dependencies explicit.
- **Turbo Frame ID collisions**: Two `<turbo-frame>` elements with the same ID on the same page cause silent update failures. Use record-based IDs: `dom_id(@user)`.
- **Mixed DOM ownership**: Let either Turbo/Stimulus or a JS island own a DOM
  subtree. Mixing Hotwire updates into DOM nodes managed by React/Vue causes
  stale UI and event rebinding bugs.

## Primary Sources

- Rails Guides: https://guides.rubyonrails.org/
- Turbo docs: https://turbo.hotwired.dev/
- Stimulus docs: https://stimulus.hotwired.dev/

# Rails Security Standards

Reference for generating `ai/instructions/security.md` in Ruby on Rails projects.

## Strong Parameters

Every controller action that accepts user input MUST use strong parameters.

```ruby
# DO — require and permit explicitly
def user_params
  params.require(:user).permit(:name, :email, :avatar)
end

User.create!(user_params)

# DON'T — pass params directly
User.create!(params[:user])           # mass assignment of any attribute
User.create!(params.permit!)          # permits everything
```

- Never call `params.permit!` — it disables all mass assignment protection.
- Nest `permit` for associations: `.permit(:name, addresses_attributes: [:street, :city])`.

## CSRF Protection

Rails includes CSRF protection by default. Never skip it for browser-facing actions.

```ruby
# DO — CSRF is on by default in ApplicationController
class ApplicationController < ActionController::Base
  protect_from_forgery with: :exception
end

# Forms automatically include the token
<%= form_with model: @order do |f| %>
  <%= f.submit "Place Order" %>
<% end %>

# DON'T — skip CSRF for browser actions
class OrdersController < ApplicationController
  skip_before_action :verify_authenticity_token  # only for API endpoints with token auth
end
```

- API-only controllers (`ActionController::API`) don't include CSRF — they rely on token auth.
- For JS fetch requests, read the CSRF token from the `<meta>` tag and send it as `X-CSRF-Token` header.

## XSS Prevention

ERB auto-escapes output by default. `html_safe` and `raw` bypass this.

```erb
<%# DO — auto-escaped output %>
<p><%= user.bio %></p>

<%# DON'T — bypass escaping %>
<p><%= user.bio.html_safe %></p>
<p><%= raw user.bio %></p>
<p><%== user.bio %></p>
```

- Only use `html_safe` on content you generated, never on user input.
- If you must render rich-text user content, sanitize with `sanitize(html, tags: %w[p br strong em])`.

## Mass Assignment

Strong parameters are the primary defense. Additionally:

```ruby
# DO — use enum safely
class Order < ApplicationRecord
  enum status: { pending: 0, confirmed: 1, shipped: 2 }
end

# DON'T — allow status in params for customer-facing actions
def order_params
  params.require(:order).permit(:product_id, :quantity, :status)  # user can set status to shipped
end
```

- Separate permitted params for different roles: `admin_order_params` vs `customer_order_params`.

## Encrypted Credentials

```bash
# DO — use Rails encrypted credentials
EDITOR=vim rails credentials:edit

# Access in code
Rails.application.credentials.stripe_api_key
Rails.application.credentials.dig(:aws, :secret_key)
```

- Never store secrets in `config/secrets.yml` (deprecated) or environment-specific config files committed to git.
- `config/master.key` must be gitignored and provided via environment variable `RAILS_MASTER_KEY` in production.

## Brakeman Security Scanner

```bash
# Run Brakeman static analysis
gem install brakeman
brakeman --no-pager

# In CI — fail on warnings
brakeman --no-pager --exit-on-warn
```

- Run Brakeman in CI on every PR. Fix all high-confidence warnings.
- Configure `.brakeman.yml` to suppress false positives with justification comments.

## Common Footguns

- **`params.permit!`**: disables strong parameters entirely. Never use in production code.
- **`html_safe` on user input**: direct XSS vulnerability. Auto-escaping is there for a reason.
- **`find_by_sql` without parameterization**: SQL injection. Use `?` placeholders: `User.find_by_sql(["SELECT * FROM users WHERE email = ?", email])`.
- **`order()` with user input**: accepts raw SQL. Whitelist sort columns: `User.order(sort_column) if %w[name created_at].include?(sort_column)`.
- **`render inline:` with user data**: server-side template injection. Never interpolate user input into ERB.
- **Missing `config/master.key` in `.gitignore`**: leaks encryption key. Rails adds it by default, but verify.
- **`protect_from_forgery with: :null_session`**: silently ignores CSRF failures instead of raising. Use `:exception` for browser apps.

# Ruby on Rails + RSpec Coding Standards

Reference for generating `ai/instructions/backend.md` in Rails projects.

## Philosophy

- Convention over configuration. Follow Rails conventions unless you have a strong, documented reason to deviate.
- "Rails way" first, extract when it hurts. Service objects, form objects, and query objects earn their place when models get too large.

## Models

- Validations on the model: `validates :email, presence: true, uniqueness: true`.
- Use callbacks sparingly — only for data integrity (e.g., `before_save :normalize_email`). DO NOT use callbacks for side effects (sending emails, creating related records). Use service objects instead.
- Use concerns for shared behavior across models, but limit to 2-3 per model.

```ruby
# DO — validation and simple callback
class User < ApplicationRecord
  validates :email, presence: true, uniqueness: { case_sensitive: false }
  before_save :normalize_email

  private

  def normalize_email
    self.email = email.downcase.strip
  end
end

# DON'T — side effects in callbacks
class Order < ApplicationRecord
  after_create :send_confirmation_email    # should be in a service
  after_create :update_inventory           # should be in a service
  after_create :notify_warehouse           # should be in a service
end
```

## Controllers

- Use `before_action` for authentication and loading resources.
- Use `strong_parameters` — always permit explicitly. Never use `.permit!`.
- Keep controllers RESTful. If an action doesn't map to CRUD, consider a new controller.

```ruby
# DO — strong params, before_action
class OrdersController < ApplicationController
  before_action :authenticate_user!
  before_action :set_order, only: [:show, :update, :destroy]

  def create
    order = CreateOrder.call(order_params, current_user: current_user)
    render json: OrderSerializer.new(order), status: :created
  end

  private

  def order_params
    params.require(:order).permit(:product_id, :quantity, :shipping_address)
  end
end

# DON'T — permit everything
params.require(:order).permit!
```

## ActiveRecord Queries

- Use `includes` (or `preload`/`eager_load`) to avoid N+1 queries.
- Use scopes for reusable query conditions.
- DO NOT use raw SQL unless ActiveRecord truly cannot express the query. When you must, use parameterized queries.

```ruby
# DO — scopes + eager loading
class Order < ApplicationRecord
  scope :active, -> { where(status: :active) }
  scope :recent, -> { order(created_at: :desc).limit(10) }
end

orders = Order.active.recent.includes(:customer, :items)

# DON'T — raw SQL with interpolation
Order.where("status = '#{params[:status]}'")  # SQL injection
```

## Background Jobs

- Use Sidekiq (or the ActiveJob adapter of choice). Jobs MUST be idempotent.
- Pass IDs to jobs, not ActiveRecord objects. Objects serialize poorly and may be stale.
- Use `retry: 5` and exponential backoff for transient failures.

```ruby
# DO — pass ID, re-fetch inside job
class SendConfirmationEmailJob < ApplicationJob
  queue_as :default

  def perform(order_id)
    order = Order.find(order_id)
    OrderMailer.confirmation(order).deliver_now
  end
end

# DON'T — pass ActiveRecord object
SendConfirmationEmailJob.perform_later(order)
```

## Testing

- Use RSpec. Prefer request specs (`spec/requests/`) over controller specs (deprecated pattern).
- Use FactoryBot for test data. DO NOT use fixtures (static YAML) for complex test setups.
- Use `let` and `let!` for lazy/eager setup. Use `before` blocks sparingly.
- Test behavior through the public interface, not internal implementation.

```ruby
# DO — request spec with factory
RSpec.describe "POST /orders", type: :request do
  let(:user) { create(:user) }
  let(:product) { create(:product, price: 1000) }

  it "creates an order" do
    sign_in user
    post orders_path, params: { order: { product_id: product.id, quantity: 2 } }

    expect(response).to have_http_status(:created)
    expect(Order.count).to eq(1)
  end
end
```

## Common Footguns

- **Callback hell**: Chains of `after_create`/`after_save` callbacks make the execution order opaque and create hidden coupling. Extract to explicit service objects.
- **N+1 queries**: Use `bullet` gem during development to detect N+1 automatically. Every `.association` access in a loop without `includes` is a separate query.
- **Mass assignment**: Using `.permit!` or assigning `params` directly lets attackers set any attribute (e.g., `role: "admin"`).
- **Unscoped queries leaking data**: `Model.find(params[:id])` lets any user access any record. Always scope to the current user: `current_user.orders.find(params[:id])`.
- **Schema divergence**: Running `rails db:migrate` locally without committing `schema.rb` causes merge conflicts and environment drift. Always commit schema changes.

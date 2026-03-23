# Laravel + Eloquent Coding Standards

Reference for generating `ai/instructions/backend.md` in Laravel projects.

## Architecture

- Controllers are thin: parse request, call service, return response. No business logic.
- Business logic in Service classes or Action classes (single-responsibility invokable classes).
- Eloquent queries in Repository classes or model scopes — not in controllers.

```php
// DO — thin controller, logic in service
class OrderController extends Controller
{
    public function store(StoreOrderRequest $request, CreateOrderAction $action): JsonResponse
    {
        $order = $action->execute($request->validated());
        return response()->json(OrderResource::make($order), 201);
    }
}

// DON'T — fat controller with inline logic
class OrderController extends Controller
{
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([...]);
        $order = Order::create($validated);
        $order->items()->createMany($request->items);
        Mail::to($order->customer)->send(new OrderConfirmation($order));
        return response()->json($order);
    }
}
```

## Eloquent

- Always use `with()` for eager loading. Every lazy-loaded relationship in a loop is an N+1 query.
- Use scopes for reusable query conditions: `scopeActive`, `scopeForCustomer`.
- Use accessors and mutators (Attribute casting in Laravel 9+) for data transformation.
- Define `$fillable` explicitly. DO NOT use `$guarded = []` — it disables mass assignment protection entirely.

```php
// DO — eager loading and scopes
$orders = Order::with(['customer', 'items'])
    ->active()
    ->forCustomer($customerId)
    ->paginate(20);

// DON'T — lazy loading in a loop
$orders = Order::all();
foreach ($orders as $order) {
    echo $order->customer->name; // N+1
}
```

## Routing

- Use `Route::resource()` for standard CRUD. Supplement with custom routes only when needed.
- Use route model binding: type-hint the model in the controller method signature.
- Group routes with middleware: `Route::middleware(['auth:sanctum'])->group(...)`.

## Validation

- Use Form Request classes for validation. DO NOT validate inline in controllers.
- Form Requests handle authorization via `authorize()` and rules via `rules()`.
- Use custom Rule objects for complex validation logic.

```php
// DO — Form Request
class StoreOrderRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'customer_id' => ['required', 'exists:customers,id'],
            'items' => ['required', 'array', 'min:1'],
            'items.*.product_id' => ['required', 'exists:products,id'],
            'items.*.quantity' => ['required', 'integer', 'min:1'],
        ];
    }
}

// DON'T — inline validation
$request->validate(['customer_id' => 'required', ...]);
```

## Queues

- Implement `ShouldQueue` on jobs. Define `$tries`, `$backoff`, and `$maxExceptions`.
- Use `ShouldBeUnique` for jobs that must not run concurrently (e.g., sending a specific report).
- DO NOT pass Eloquent models directly to jobs — pass the ID and re-fetch. Models serialize poorly and may be stale.

## Testing

- Use `RefreshDatabase` trait for tests that write to the database.
- Use model factories for test data. DO NOT seed production data in tests.
- Prefer Pest over PHPUnit for cleaner syntax. Both work — follow project convention.
- Use `Mockery` for mocking, or Pest's built-in mocking.

```php
// DO — factory-based test
it('creates an order', function () {
    $customer = Customer::factory()->create();
    $product = Product::factory()->create(['price' => 1000]);

    $response = $this->actingAs($customer)
        ->postJson('/api/orders', [
            'items' => [['product_id' => $product->id, 'quantity' => 2]],
        ]);

    $response->assertStatus(201);
    expect(Order::count())->toBe(1);
});
```

## Artisan Commands

- Create custom commands for CLI tasks: scheduled jobs, data imports, maintenance.
- Use `$this->info()`, `$this->error()`, and `$this->table()` for output.
- Register commands in the scheduler via `app/Console/Kernel.php`.

## Common Footguns

- **Mass assignment**: Using `$guarded = []` or passing unvalidated input to `create()` lets attackers set any column (e.g., `is_admin`).
- **N+1 queries**: Every `$order->customer` access in a Blade loop triggers a query. Use `with()` or install `beyondcode/laravel-query-detector` to catch them.
- **Unescaped Blade output**: `{!! $variable !!}` renders raw HTML. Use `{{ $variable }}` (auto-escaped) unless you explicitly need raw output and have sanitized the input.
- **env() outside config files**: `env()` returns `null` when the config is cached (`php artisan config:cache`). Always wrap environment variables in config files and reference them with `config()`.
- **Missing queue worker in production**: Jobs sit in the queue forever if no worker is running. Set up Supervisor or Horizon to keep workers alive.

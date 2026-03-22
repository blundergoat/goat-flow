# .NET + EF Core Coding Standards

Reference for generating `ai/instructions/backend.md` in .NET projects.

## Architecture

- Clean Architecture: Controllers -> Application (MediatR commands/queries) -> Domain (entities, value objects) -> Infrastructure (EF Core, external services).
- Controllers are thin: dispatch to MediatR, return results. No business logic.
- Domain entities are persistence-ignorant. EF Core mapping goes in `Infrastructure/`.

```csharp
// DO — thin controller dispatching to MediatR
[ApiController]
[Route("api/[controller]")]
public class OrdersController : ControllerBase
{
    private readonly IMediator _mediator;

    public OrdersController(IMediator mediator) => _mediator = mediator;

    [HttpPost]
    public async Task<IActionResult> Create(CreateOrderCommand command)
    {
        var orderId = await _mediator.Send(command);
        return CreatedAtAction(nameof(GetById), new { id = orderId }, null);
    }
}

// DON'T — business logic in the controller
[HttpPost]
public async Task<IActionResult> Create(CreateOrderRequest request)
{
    var order = new Order { CustomerId = request.CustomerId };
    foreach (var item in request.Items)
    {
        var product = await _db.Products.FindAsync(item.ProductId);
        order.Items.Add(new OrderItem { Product = product, Quantity = item.Quantity });
    }
    _db.Orders.Add(order);
    await _db.SaveChangesAsync();
    return Ok(order); // leaks entire entity
}
```

## EF Core

- Use `DbContext` with `AddDbContext<AppDbContext>()` in DI. Configure entity mapping in `IEntityTypeConfiguration<T>` classes.
- Use `Include()` for eager loading related entities. Use `AsNoTracking()` for read-only queries.
- Run migrations with `dotnet ef migrations add` then review generated code. Never hand-edit migration files.
- Use `SaveChangesAsync()` — never the synchronous version in async code paths.

```csharp
// DO — explicit Include, AsNoTracking for reads
var orders = await context.Orders
    .AsNoTracking()
    .Include(o => o.Items)
    .ThenInclude(i => i.Product)
    .Where(o => o.CustomerId == customerId)
    .ToListAsync();

// DON'T — lazy loading triggers N+1
var orders = await context.Orders.Where(o => o.CustomerId == customerId).ToListAsync();
foreach (var order in orders)
{
    Console.WriteLine(order.Items.Count); // N+1 query per order
}
```

## Dependency Injection

- Use `AddScoped` for per-request services (DbContext, repositories). Use `AddSingleton` for stateless services (configuration, HTTP clients). Use `AddTransient` for lightweight, stateless helpers.
- Use `IOptions<T>` pattern for strongly-typed configuration. Bind from `appsettings.json` sections.
- DO NOT resolve scoped services from a singleton — it causes captive dependency bugs.

```csharp
// DO — IOptions pattern
services.Configure<SmtpSettings>(configuration.GetSection("Smtp"));

public class EmailService
{
    private readonly SmtpSettings _settings;
    public EmailService(IOptions<SmtpSettings> options) => _settings = options.Value;
}

// DON'T — reading config directly
var host = configuration["Smtp:Host"]; // stringly typed, no validation
```

## API Style

- Follow project convention: Minimal APIs for lightweight services, Controllers for larger apps.
- Use `TypedResults` with Minimal APIs for OpenAPI schema generation.
- Return `IActionResult` or typed results — DO NOT return raw entities from controllers.

## Validation

- Use FluentValidation for complex rules or DataAnnotations for simple ones — pick one per project.
- Validate in the pipeline (MediatR behaviors or action filters), not manually in controllers.

```csharp
// DO — FluentValidation
public class CreateOrderCommandValidator : AbstractValidator<CreateOrderCommand>
{
    public CreateOrderCommandValidator()
    {
        RuleFor(x => x.CustomerId).NotEmpty();
        RuleFor(x => x.Items).NotEmpty();
        RuleForEach(x => x.Items).ChildRules(item =>
        {
            item.RuleFor(i => i.Quantity).GreaterThan(0);
        });
    }
}
```

## Testing

- Use xUnit as the test framework. Use `Moq` or `NSubstitute` for mocking interfaces.
- Use `WebApplicationFactory<Program>` for integration tests that spin up the full pipeline.
- Use Testcontainers for database integration tests against a real database.
- Isolate unit tests: no database, no HTTP, no file system. Mock all infrastructure.

```csharp
// DO — integration test with WebApplicationFactory
public class OrdersTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly HttpClient _client;

    public OrdersTests(WebApplicationFactory<Program> factory)
    {
        _client = factory.CreateClient();
    }

    [Fact]
    public async Task CreateOrder_Returns201()
    {
        var command = new { CustomerId = Guid.NewGuid(), Items = new[] { new { ProductId = Guid.NewGuid(), Quantity = 1 } } };
        var response = await _client.PostAsJsonAsync("/api/orders", command);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }
}
```

## Common Footguns

- **DbContext lifetime**: `DbContext` is scoped per request. Injecting it into a singleton captures a disposed context. Always use `AddScoped` and inject `IDbContextFactory` into singletons.
- **async void**: `async void` methods swallow exceptions silently and crash the process. Always use `async Task`. For backend code, NEVER use async void. No exceptions.
- **Disposed ObjectContext**: Accessing navigation properties after the DbContext is disposed throws. Eager-load with `Include()` or project to a DTO before the context scope ends.
- **N+1 queries**: EF Core lazy loading (if enabled) silently fires queries per navigation access. Use `AsNoTracking().Include()` and check SQL logs during development.
- **IEnumerable vs IQueryable**: Calling `.ToList()` too early pulls the entire table into memory. Keep the query as `IQueryable` until you need to materialize results.

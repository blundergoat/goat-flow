# TypeScript Node.js Coding Standards (Express / Fastify oriented; adapt for Nest)

Reference for generating `ai/instructions/backend.md` in Node.js backend projects.

This file is strongest for Express and Fastify services. If the repo uses Nest,
keep the validation, env, testing, and contract guidance, but map request
pipeline concerns to Nest modules, providers, pipes, guards, interceptors, and
exception filters instead of copying raw Express middleware patterns.

## Project Structure

- Organize by domain: `modules/users/`, `modules/orders/` — each with routes, controllers, services, and repositories.
- Entry point sets up server, middleware, and routes. No business logic in the entry file.
- Routes -> Controllers (parse HTTP) -> Services (business logic) -> Repositories (data access).
- In Nest, the equivalent shape is modules -> controllers -> providers/services
  -> repositories/adapters. Preserve the repo's existing module boundaries.

## Middleware

- Register error-handling middleware last — Express calls it when `next(err)` is invoked.
- Wrap async route handlers to catch rejected promises. Express 4 does not catch async errors automatically.
- Use Fastify's built-in async error handling or Express 5+ which handles async natively.
- In Nest, prefer exception filters, guards, pipes, and interceptors over
  ad-hoc middleware for validation, auth, and error translation.

```typescript
// DO — async error wrapper for Express 4
const asyncHandler = (fn: RequestHandler): RequestHandler =>
  (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get('/orders/:id', asyncHandler(async (req, res) => {
  const order = await orderService.getById(req.params.id);
  if (!order) throw new NotFoundError('Order not found');
  res.json(order);
}));

// DON'T — unhandled rejection crashes the process
router.get('/orders/:id', async (req, res) => {
  const order = await orderService.getById(req.params.id); // if this throws, Express hangs
  res.json(order);
});
```

## Validation

- Validate at route boundaries with Zod or Joi. DO NOT trust request data past the controller.
- Parse, don't validate — use Zod's `.parse()` which returns a typed object and throws on invalid input.

```typescript
// DO — Zod schema at the boundary
const CreateOrderSchema = z.object({
  customerId: z.string().uuid(),
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.number().int().positive(),
  })).min(1),
});

router.post('/orders', asyncHandler(async (req, res) => {
  const body = CreateOrderSchema.parse(req.body);
  const order = await orderService.create(body);
  res.status(201).json(order);
}));

// DON'T — manual validation scattered through the service
if (!req.body.customerId) return res.status(400).json({ error: 'missing customerId' });
```

## Database

- Use the repo's existing data layer. Prisma and Knex are common examples, not
  required defaults.
- Prisma fits type-safe ORM projects with generated client + migrations.
- Knex fits query-builder projects that need more SQL control.
- Migrations are mandatory. DO NOT modify the database schema by hand.
- Use transactions for multi-step writes: `prisma.$transaction([...])` or `knex.transaction(...)`.

```typescript
// DO — Prisma with transaction
const order = await prisma.$transaction(async (tx) => {
  const order = await tx.order.create({ data: { customerId } });
  await tx.orderItem.createMany({ data: items.map(i => ({ ...i, orderId: order.id })) });
  return order;
});

// DON'T — multiple writes without transaction
const order = await prisma.order.create({ data: { customerId } });
await prisma.orderItem.createMany({ data: items }); // if this fails, orphaned order remains
```

## Error Handling

- Define custom error classes extending a base `AppError` with `statusCode` and `isOperational`.
- Centralized error handler maps errors to HTTP responses. Log unexpected errors, return generic message.
- DO NOT catch errors silently — either handle them or let them propagate to the error handler.

```typescript
// DO — custom error class
class NotFoundError extends AppError {
  constructor(message: string) {
    super(message, 404);
  }
}

// Centralized handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ error: err.message });
  }
  logger.error(err);
  res.status(500).json({ error: 'Internal server error' });
});
```

## Testing

- Use Vitest or Jest for unit and integration tests.
- Use `supertest` for HTTP-level testing against the Express/Fastify app.
- Mock the database layer with in-memory SQLite (Prisma) or testcontainers for integration tests.
- Isolate tests: each test creates its own data, no shared mutable state.
- In Nest, use `@nestjs/testing` to build modules for unit tests and pair it
  with `supertest` for end-to-end HTTP tests.

```typescript
// DO — supertest integration test
describe('POST /orders', () => {
  it('creates an order and returns 201', async () => {
    const customer = await createTestCustomer();
    const response = await request(app)
      .post('/orders')
      .send({ customerId: customer.id, items: [{ productId: 'abc', quantity: 1 }] })
      .expect(201);

    expect(response.body).toHaveProperty('id');
  });
});
```

## Common Footguns

- **Unhandled promise rejections**: In Node 18+, unhandled rejections crash the process. Always catch or propagate. Never fire-and-forget an async function.
- **Event loop blocking**: CPU-intensive work (crypto, JSON parsing large payloads, image processing) blocks all requests. Offload to worker threads or a separate service.
- **Memory leaks in closures**: Event listeners, intervals, and cached closures that reference large objects prevent garbage collection. Clean up on shutdown.
- **Missing Content-Type validation**: Not checking `Content-Type` header allows attackers to send malformed payloads that bypass body parsers.
- **Trusting process.env types**: All `process.env` values are `string | undefined`. Parse and validate at startup with Zod or `envalid`, not at point of use.

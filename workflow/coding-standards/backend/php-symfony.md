# Symfony + Doctrine Coding Standards

Reference for generating `ai/instructions/backend.md` in Symfony projects.

## Architecture

- Bundle-free application structure (Symfony 6+). Put code in `src/` with clear namespace boundaries. Note: This guide targets Symfony 6+. Symfony 5 LTS projects may still use bundles.
- Services are auto-wired by default. Use constructor injection — DO NOT fetch services from the container manually.
- Organize by domain: `src/User/`, `src/Order/`, not `src/Entity/`, `src/Repository/`, `src/Controller/`.

```php
// DO — constructor injection
class OrderService
{
    public function __construct(
        private readonly OrderRepository $orderRepository,
        private readonly MailerInterface $mailer,
    ) {}
}

// DON'T — container access
class OrderService
{
    public function doSomething(): void
    {
        $repo = $this->container->get(OrderRepository::class);
    }
}
```

## Doctrine ORM

- Entities are plain PHP objects with Doctrine attributes. Keep business logic on the entity where it belongs.
- Use custom Repository methods over raw DQL in controllers.
- Use DQL or QueryBuilder for complex queries. Prefer DQL over raw SQL unless you need database-specific features.
- Always run migrations via `doctrine:migrations:migrate`. Never modify the schema manually.

```php
// DO — repository method with QueryBuilder
public function findActiveByCustomer(int $customerId): array
{
    return $this->createQueryBuilder('o')
        ->andWhere('o.customer = :customerId')
        ->andWhere('o.status = :status')
        ->setParameter('customerId', $customerId)
        ->setParameter('status', OrderStatus::Active)
        ->getQuery()
        ->getResult();
}

// DON'T — raw DQL in the controller
$orders = $em->createQuery("SELECT o FROM Order o WHERE o.customer = $id")->getResult();
```

## Controllers

- Use `#[Route]` PHP attributes for routing. Group related routes on the controller class.
- Extend `AbstractController` for convenience methods (`json()`, `render()`, `redirectToRoute()`).
- One action per method. DO NOT put multiple routes on a single method.
- Return typed responses: `JsonResponse`, `Response`, `RedirectResponse`.

```php
#[Route('/api/orders', name: 'order_')]
class OrderController extends AbstractController
{
    #[Route('', methods: ['GET'], name: 'list')]
    public function list(OrderRepository $repo): JsonResponse
    {
        return $this->json($repo->findActive());
    }

    #[Route('/{id}', methods: ['GET'], name: 'show')]
    public function show(Order $order): JsonResponse
    {
        return $this->json($order);
    }
}
```

## Forms and Validation

- Use `FormType` classes for form handling. DO NOT validate manually with `if ($request->get(...))`.
- Apply validation constraints on entity properties via attributes: `#[Assert\NotBlank]`, `#[Assert\Email]`.
- Use validation groups when the same entity has different rules for creation vs. update.

## Messenger

- Use Symfony Messenger for async work: define a Message (DTO), a Handler, and a Transport.
- Handlers are auto-discovered. One handler per message.
- Configure transports in `messenger.yaml`: use `doctrine` for simplicity, `amqp` or `redis` for scale.
- Stamp messages with `DelayStamp` for scheduled execution.

```php
// DO — message + handler
final readonly class SendOrderConfirmation
{
    public function __construct(public int $orderId) {}
}

#[AsMessageHandler]
final class SendOrderConfirmationHandler
{
    public function __construct(private MailerInterface $mailer) {}

    public function __invoke(SendOrderConfirmation $message): void
    {
        // fetch order, send email
    }
}
```

## Testing

- `KernelTestCase` for service-level tests that need the container.
- `WebTestCase` with `$client = static::createClient()` for HTTP tests.
- Use `zenstruck/foundry` for factory-based test data. DO NOT create entities manually in every test.
- Use `.env.test` for test-specific configuration. Never point tests at a production database.

## Common Footguns

- **Lazy loading outside request**: Accessing a lazy-loaded relation after the EntityManager is closed throws a `LazyInitializationException`. Use `JOIN FETCH` in DQL or `addSelect()` in QueryBuilder.
- **flush() without transaction**: Calling `$em->flush()` without wrapping writes in a transaction means partial writes on failure. Use `$em->wrapInTransaction(function () { ... })`.
- **Circular dependency injection**: Two services that depend on each other cause a container build error. Break the cycle with an event, a mediator, or `#[Lazy]` proxies.
- **N+1 in serialization**: Serializing an entity collection that has unfetched relations triggers N+1 queries during JSON encoding. Eager-fetch or use a DTO.
- **Missing return type on controller**: Forgetting the return type causes Symfony to return an empty 200 instead of the intended response.

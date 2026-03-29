# Spring Boot Backend Standards (Spring Boot + JPA oriented)

Reference for generating `ai/instructions/backend.md` in Spring Boot projects.

This file assumes Spring Boot with Spring Data/JPA as the common case. If the
repo uses jOOQ, MyBatis, JdbcTemplate, or another data layer, keep the DI,
validation, security, and testing guidance and replace only the persistence
section with the patterns actually present in the repo.

## Architecture

- Layered architecture: `@RestController` -> `@Service` -> `@Repository`.
- Controllers handle HTTP concerns only: request mapping, response status, content negotiation.
- Services hold business logic and orchestrate repositories. One service per domain aggregate.

## Dependency Injection

- Use constructor injection exclusively. DO NOT use `@Autowired` on fields.
- Mark dependencies `final`. Spring auto-detects single-constructor injection — no `@Autowired` annotation needed.

```java
// DO — constructor injection with final fields
@Service
public class OrderService {
    private final OrderRepository orderRepository;
    private final PaymentGateway paymentGateway;

    public OrderService(OrderRepository orderRepository, PaymentGateway paymentGateway) {
        this.orderRepository = orderRepository;
        this.paymentGateway = paymentGateway;
    }
}

// DON'T — field injection
@Service
public class OrderService {
    @Autowired private OrderRepository orderRepository;
    @Autowired private PaymentGateway paymentGateway;
}
```

## JPA / Spring Data (if the repo uses JPA)

- Use Spring Data repositories with derived query methods for simple queries.
- Use `@Query` with JPQL for complex queries. Use `Specification` for dynamic filters.
- Always define `FetchType.LAZY` on relationships. Eager-fetch explicitly when needed with `JOIN FETCH` or `@EntityGraph`.
- Use `@Transactional(readOnly = true)` on read-only service methods for performance.

```java
// DO — explicit fetch to avoid N+1
@Query("SELECT o FROM Order o JOIN FETCH o.items WHERE o.customer.id = :customerId")
List<Order> findByCustomerWithItems(@Param("customerId") Long customerId);

// DON'T — rely on lazy loading in a loop
List<Order> orders = orderRepository.findByCustomerId(customerId);
orders.forEach(o -> o.getItems().size()); // N+1 queries
```

## Validation

- Use `@Valid` on request body parameters to trigger Bean Validation.
- Define constraints on the DTO: `@NotBlank`, `@Size`, `@Email`, `@Positive`.
- Write custom `ConstraintValidator` for business rules that don't fit standard annotations.
- Handle `MethodArgumentNotValidException` in a `@ControllerAdvice` for consistent error responses.

```java
// DO — validated DTO
public record CreateOrderRequest(
    @NotNull Long customerId,
    @NotEmpty List<@Valid OrderItemRequest> items
) {}

@PostMapping("/orders")
public ResponseEntity<OrderResponse> create(@Valid @RequestBody CreateOrderRequest request) {
    return ResponseEntity.status(201).body(orderService.create(request));
}
```

## Security

- Configure `SecurityFilterChain` as a `@Bean`. DO NOT extend `WebSecurityConfigurerAdapter` (deprecated).
- Use method-level security with `@PreAuthorize("hasRole('ADMIN')")` for fine-grained control.
- Store passwords with `BCryptPasswordEncoder`. Never roll custom hashing.

## Testing

- `@SpringBootTest` for full integration tests that load the entire context.
- `@WebMvcTest(OrderController.class)` for controller-only tests with mocked services.
- Use `Testcontainers` for database integration tests against a real database.
- Use `@DataJpaTest` for repository tests with an embedded database.

```java
// DO — sliced test for controller
@WebMvcTest(OrderController.class)
class OrderControllerTest {
    @Autowired private MockMvc mockMvc;
    @MockBean private OrderService orderService;

    @Test
    void createOrder_returns201() throws Exception {
        when(orderService.create(any())).thenReturn(new OrderResponse(1L));

        mockMvc.perform(post("/orders")
                .contentType(APPLICATION_JSON)
                .content("{\"customerId\":1,\"items\":[]}"))
            .andExpect(status().isCreated());
    }
}
```

## Common Footguns

- **LazyInitializationException**: Accessing a lazy collection outside a transaction (e.g., in a serializer) throws. Use `JOIN FETCH`, `@EntityGraph`, or a DTO projection.
- **N+1 with JPA**: Loading a list of entities then accessing their relations generates one query per entity. Always check SQL logs during development.
- **Circular dependencies**: Two `@Service` classes injecting each other causes a startup error. Break with `@Lazy`, an event, or restructure the dependency graph.
- **Missing @Transactional**: Service methods that write without `@Transactional` don't roll back on exceptions. Every write operation needs a transaction boundary.
- **Leaking entity in response**: Returning JPA entities directly from controllers exposes internal fields and triggers lazy loading. Map to a response DTO.

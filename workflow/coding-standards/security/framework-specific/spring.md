# Spring Boot Security Standards

Reference for generating `ai/instructions/security.md` in Spring Boot projects.

## Spring Security Configuration

Use `SecurityFilterChain` bean configuration (not the deprecated `WebSecurityConfigurerAdapter`).

```java
// DO — SecurityFilterChain bean
@Bean
public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
    return http
        .authorizeHttpRequests(auth -> auth
            .requestMatchers("/api/public/**").permitAll()
            .requestMatchers("/api/admin/**").hasRole("ADMIN")
            .anyRequest().authenticated()
        )
        .csrf(csrf -> csrf.csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse()))
        .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
        .build();
}

// DON'T — overly permissive security
@Bean
public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
    return http
        .authorizeHttpRequests(auth -> auth.anyRequest().permitAll())
        .csrf(csrf -> csrf.disable())  // only disable for stateless API with token auth
        .build();
}
```

- Deny by default. List public endpoints explicitly, authenticate everything else.
- Only disable CSRF for truly stateless APIs using JWT/token auth (no cookies).

## CSRF Configuration

```java
// DO — CSRF with cookie-based token for SPAs
.csrf(csrf -> csrf
    .csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse())
    .csrfTokenRequestHandler(new SpaCsrfTokenRequestHandler())
)

// DO — disable CSRF only for stateless JWT APIs
.csrf(csrf -> csrf.disable())
// ONLY when session policy is STATELESS and no cookies are used for auth
```

- For server-rendered Thymeleaf/JSP apps, CSRF tokens are included automatically in forms.
- For SPAs, read the XSRF-TOKEN cookie and send it back as `X-XSRF-TOKEN` header.

## Method-Level Authorization

```java
// DO — method-level security with @PreAuthorize
@PreAuthorize("hasRole('ADMIN')")
@DeleteMapping("/users/{id}")
public ResponseEntity<Void> deleteUser(@PathVariable Long id) {
    userService.delete(id);
    return ResponseEntity.noContent().build();
}

// DO — expression-based access control
@PreAuthorize("#userId == authentication.principal.id or hasRole('ADMIN')")
@GetMapping("/users/{userId}/profile")
public UserProfile getProfile(@PathVariable Long userId) { ... }

// DON'T — check roles manually in controller body
@DeleteMapping("/users/{id}")
public ResponseEntity<Void> deleteUser(@PathVariable Long id, Authentication auth) {
    if (!auth.getAuthorities().contains("ROLE_ADMIN")) {  // easy to forget
        throw new AccessDeniedException("Not admin");
    }
    ...
}
```

- Enable method security: `@EnableMethodSecurity` on a config class.
- Use `@PreAuthorize` over `@Secured` — it supports SpEL expressions.

## Actuator Endpoint Protection

```yaml
# DO — restrict actuator endpoints
management:
  endpoints:
    web:
      exposure:
        include: health, info, metrics
  endpoint:
    health:
      show-details: when_authorized

# DON'T — expose all actuator endpoints
management:
  endpoints:
    web:
      exposure:
        include: "*"   # exposes env, configprops, heapdump — leaks secrets
```

- Never expose `env`, `configprops`, `heapdump`, or `shutdown` endpoints publicly.
- Require authentication for all actuator endpoints except `health`.

## Secrets in application.yml

```yaml
# DO — use environment variables
spring:
  datasource:
    url: ${DATABASE_URL}
    username: ${DATABASE_USER}
    password: ${DATABASE_PASSWORD}

# DON'T — hardcode credentials
spring:
  datasource:
    url: jdbc:postgresql://db.example.com:5432/prod
    username: admin
    password: s3cret123
```

- Use Spring Cloud Config, Vault, or AWS SSM for production secrets.
- Never commit `application-prod.yml` with real credentials.

## Input Validation

```java
// DO — validate with @Valid and constraints
public record CreateUserRequest(
    @NotBlank @Email String email,
    @NotBlank @Size(min = 8, max = 128) String password,
    @NotBlank @Size(max = 255) String name
) {}

@PostMapping("/users")
public ResponseEntity<User> createUser(@Valid @RequestBody CreateUserRequest request) { ... }

// DON'T — no validation on input
@PostMapping("/users")
public ResponseEntity<User> createUser(@RequestBody Map<String, Object> body) {
    String email = (String) body.get("email");  // no validation, type-unsafe
    ...
}
```

- Use Jakarta Bean Validation (`@Valid`) on all request bodies and path variables.
- Return `400 Bad Request` with field-level errors, not stack traces.

## Common Footguns

- **`csrf.disable()` with session auth**: disables CSRF protection while using cookies. Only disable for stateless token auth.
- **Actuator `include: "*"`**: exposes `/env` (shows all config including secrets) and `/heapdump` (full memory dump).
- **Credentials in `application.yml`**: committed to git. Use `${ENV_VAR}` placeholders.
- **Missing `@Valid`**: Spring does not validate request bodies unless you annotate the parameter.
- **`@Query` with concatenation**: `@Query("SELECT u FROM User u WHERE u.email = '" + email + "'")` is injectable. Use `:param` named parameters.
- **Verbose error responses**: default Spring error handler may leak class names and stack traces. Configure a custom `@ControllerAdvice` error handler.

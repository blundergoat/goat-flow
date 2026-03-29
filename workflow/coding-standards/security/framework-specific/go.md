# Go Security Standards

Reference for generating `ai/instructions/security.md` in Go projects.

## Cryptographic Randomness

```go
// DO — crypto/rand for secrets, tokens, keys
import "crypto/rand"
token := make([]byte, 32)
_, err := crypto_rand.Read(token)

// DON'T — math/rand for security-sensitive values
import "math/rand"
token := rand.Intn(999999)  // predictable, not cryptographically secure
```

- Always use `crypto/rand` for generating tokens, secrets, session IDs, and any security-sensitive random values.
- `math/rand` (even with `rand.New(rand.NewSource(time.Now().UnixNano()))`) is predictable and not suitable for security.

## Template Engines

```go
// DO — html/template for HTML output (auto-escapes by default)
import "html/template"
tmpl := template.Must(template.New("page").Parse(`<p>Hello, {{.Name}}</p>`))

// DON'T — text/template for HTML output (no escaping = XSS)
import "text/template"
tmpl := template.Must(template.New("page").Parse(`<p>Hello, {{.Name}}</p>`))
```

- `html/template` auto-escapes output based on context (HTML, JS, URL, CSS). Always use it for HTML.
- `text/template` performs no escaping. Using it for HTML output is a direct XSS vulnerability.

## Timing-Safe Comparison

```go
// DO — constant-time comparison for secrets
import "crypto/subtle"
if subtle.ConstantTimeCompare([]byte(provided), []byte(expected)) != 1 {
    return ErrInvalidToken
}

// DON'T — regular string comparison (timing side-channel)
if provided != expected {
    return ErrInvalidToken
}
```

- Use `crypto/subtle.ConstantTimeCompare` for comparing passwords, tokens, HMAC signatures, and API keys.
- Regular `==` comparison leaks information about which byte position differs through timing differences.

## SSRF Prevention

```go
// DO — validate URL before making outbound request
import "net/url"

func safeGet(rawURL string) (*http.Response, error) {
    u, err := url.Parse(rawURL)
    if err != nil {
        return nil, err
    }
    if u.Scheme != "https" {
        return nil, errors.New("only HTTPS allowed")
    }
    // Resolve and check IP against blocklist (127.0.0.0/8, 10.0.0.0/8, 169.254.169.254, etc.)
    // before making the request
    return http.Get(u.String())
}

// DON'T — pass user URL directly
resp, err := http.Get(userProvidedURL)  // SSRF: user can target internal services
```

- Common in proxy, webhook, and image-fetch handlers. Always validate the target URL.
- Block private/internal IP ranges and the cloud metadata endpoint (`169.254.169.254`).

## HTTP Client Timeouts

```go
// DO — set explicit timeouts
client := &http.Client{
    Timeout: 10 * time.Second,
}

// DON'T — use the default client (no timeout)
resp, err := http.Get(url)  // hangs forever on slow/malicious server
```

- The default `http.Client` and `http.Get` have no timeout. A slow or malicious server can hold connections indefinitely.
- Set `Timeout` on the client, or use `context.WithTimeout` per-request for finer control.

## Goroutine Panic Recovery

```go
// DO — recover from panics in HTTP handlers
func recoverMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        defer func() {
            if err := recover(); err != nil {
                log.Printf("panic: %v\n%s", err, debug.Stack())
                http.Error(w, "Internal Server Error", 500)
            }
        }()
        next.ServeHTTP(w, r)
    })
}
```

- An unrecovered panic in an HTTP handler crashes the entire process. Use recovery middleware.
- Most frameworks (Gin, Echo, Chi) include panic recovery middleware — ensure it is enabled.

## Common Footguns

- **`math/rand` for tokens**: predictable output. Always `crypto/rand`.
- **`text/template` for HTML**: no escaping, direct XSS. Always `html/template`.
- **`http.Get(userURL)` without validation**: SSRF. Validate scheme, resolve IP, check against blocklist.
- **Default HTTP client**: no timeout, hangs forever. Always set `Timeout`.
- **Unrecovered goroutine panic**: crashes the process. Use recovery middleware.
- **`==` for secret comparison**: timing side-channel. Use `crypto/subtle.ConstantTimeCompare`.

## Primary Sources

- Go Standard Library documentation (pkg.go.dev/std)
- Go Security Best Practices (go.dev/doc/security/best-practices)
- OWASP Go Security Cheat Sheet

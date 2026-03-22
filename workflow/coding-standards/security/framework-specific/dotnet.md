# ASP.NET Core Security Standards

Reference for generating `ai/instructions/security.md` in ASP.NET Core projects.

## Anti-Forgery Tokens (CSRF)

Razor Pages and MVC include anti-forgery tokens by default. Verify they are active.

```csharp
// DO — anti-forgery in Razor forms (automatic with tag helpers)
<form asp-action="Create" method="post">
    <!-- token is included automatically by the form tag helper -->
    <button type="submit">Create</button>
</form>

// DO — validate anti-forgery on POST actions
[HttpPost]
[ValidateAntiForgeryToken]
public IActionResult Create(OrderModel model) { ... }

// DON'T — skip validation
[HttpPost]
[IgnoreAntiforgeryToken]  // only for webhook endpoints with signature verification
public IActionResult Create(OrderModel model) { ... }
```

- For APIs using JWT/token auth (no cookies), anti-forgery is not needed.
- For SPAs with cookie auth, configure anti-forgery token in a cookie: `builder.Services.AddAntiforgery(o => o.HeaderName = "X-XSRF-TOKEN");`.

## ASP.NET Core Identity

```csharp
// DO — configure Identity with strong defaults
builder.Services.AddIdentity<AppUser, IdentityRole>(options =>
{
    options.Password.RequiredLength = 12;
    options.Password.RequireNonAlphanumeric = true;
    options.Lockout.MaxFailedAccessAttempts = 5;
    options.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(15);
    options.User.RequireUniqueEmail = true;
})
.AddEntityFrameworkStores<AppDbContext>()
.AddDefaultTokenProviders();

// DON'T — weaken password requirements
options.Password.RequiredLength = 4;
options.Password.RequireDigit = false;
options.Password.RequireNonAlphanumeric = false;
```

- Use the built-in password hasher (PBKDF2). Do not implement custom hashing.
- Enable account lockout to prevent brute-force attacks.

## Data Protection API

```csharp
// DO — use Data Protection for encrypting sensitive data
public class SecureService
{
    private readonly IDataProtector _protector;

    public SecureService(IDataProtectionProvider provider)
    {
        _protector = provider.CreateProtector("SecureService.v1");
    }

    public string Protect(string plaintext) => _protector.Protect(plaintext);
    public string Unprotect(string encrypted) => _protector.Unprotect(encrypted);
}

// DON'T — roll your own encryption
var encrypted = Convert.ToBase64String(Encoding.UTF8.GetBytes(secret));  // encoding is not encryption
```

- Configure key storage for production: Azure Key Vault, AWS SSM, or a shared file system for load-balanced apps.
- Set key expiration and rotation policies.

## HTTPS Redirection

```csharp
// DO — enforce HTTPS in production
var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

app.UseHttpsRedirection();
app.UseHsts();

// In Program.cs — configure HSTS
builder.Services.AddHsts(options =>
{
    options.MaxAge = TimeSpan.FromDays(730);
    options.IncludeSubDomains = true;
    options.Preload = true;
});

// DON'T — skip HTTPS enforcement
// app.UseHttpsRedirection();  // commented out "for testing"
```

## Output Encoding

Razor auto-encodes output by default. `Html.Raw()` bypasses encoding.

```csharp
// DO — auto-encoded output (default Razor behavior)
<p>@Model.UserBio</p>

// DON'T — bypass encoding with user content
<p>@Html.Raw(Model.UserBio)</p>  // XSS if UserBio contains script tags

// DO — if raw HTML is needed, sanitize first
@Html.Raw(HtmlSanitizer.Sanitize(Model.UserBio))
```

- Use `HtmlEncoder`, `JavaScriptEncoder`, or `UrlEncoder` when building strings for different contexts.
- Never concatenate user input into JavaScript blocks in Razor.

## Authorization Policies

```csharp
// DO — define and enforce policies
builder.Services.AddAuthorization(options =>
{
    options.AddPolicy("AdminOnly", policy => policy.RequireRole("Admin"));
    options.AddPolicy("CanEditOrder", policy =>
        policy.RequireAssertion(ctx =>
            ctx.User.HasClaim("permission", "orders:write")));
    options.FallbackPolicy = new AuthorizationPolicyBuilder()
        .RequireAuthenticatedUser()
        .Build();
});

// Apply to controllers/actions
[Authorize(Policy = "AdminOnly")]
[HttpDelete("users/{id}")]
public IActionResult DeleteUser(int id) { ... }

// DON'T — check roles manually in controller body
[HttpDelete("users/{id}")]
public IActionResult DeleteUser(int id)
{
    if (!User.IsInRole("Admin"))  // easy to forget on new endpoints
        return Forbid();
    ...
}
```

- Set `FallbackPolicy` to require authentication by default. Mark public endpoints explicitly with `[AllowAnonymous]`.
- Use policy-based authorization over role checks for complex permission logic.

## Common Footguns

- **`[IgnoreAntiforgeryToken]`**: disables CSRF protection. Only for non-browser API endpoints.
- **`Html.Raw()` with user content**: direct XSS. Auto-encoding exists for a reason.
- **Weak password settings**: lowering `RequiredLength` or disabling complexity invites credential stuffing.
- **Missing `FallbackPolicy`**: new endpoints are public by default unless you remember `[Authorize]`.
- **Connection strings in `appsettings.json`**: committed to git. Use User Secrets (dev), environment variables, or Key Vault (prod).
- **`[FromQuery]` without validation**: query parameters are user input. Validate with data annotations or FluentValidation.
- **Detailed error pages in production**: `app.UseDeveloperExceptionPage()` leaks stack traces. Use `app.UseExceptionHandler("/error")` in production.

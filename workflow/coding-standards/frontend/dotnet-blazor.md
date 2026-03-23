# .NET Blazor Coding Standards

Reference for generating `ai/instructions/frontend.md` in Blazor projects.

## Server vs WebAssembly

- **Blazor Server**: UI events handled over SignalR. Fast initial load, requires persistent connection. Good for intranet apps.
- **Blazor WebAssembly (WASM)**: Runs in the browser. Larger initial download, works offline. Good for public-facing SPAs.
- **Blazor United (.NET 8+)**: Mix Server and WASM per-component with `@rendermode`. Prefer this for new projects.
- Code structure is the same for both. The hosting model is a deployment decision, not an architecture decision.

```razor
@* .NET 8+ — per-component render mode *@
<UserDashboard @rendermode="InteractiveServer" />
<HeavyChart @rendermode="InteractiveWebAssembly" />
```

## Component Lifecycle

- `OnInitializedAsync` for data fetching on component load. This is the primary lifecycle method.
- `OnParametersSetAsync` when you need to react to parameter changes (re-fetch when a route param changes).
- DO NOT put heavy logic in `SetParametersAsync` — it runs on every render cycle.
- `Dispose` (implement `IDisposable`) for cleaning up event handlers, timers, and subscriptions.

```csharp
// DO — data fetching in OnInitializedAsync
@code {
    private List<User>? users;

    protected override async Task OnInitializedAsync()
    {
        users = await UserService.GetUsersAsync();
    }
}

// DON'T — fetching in OnAfterRenderAsync
protected override async Task OnAfterRenderAsync(bool firstRender)
{
    if (firstRender)
    {
        users = await UserService.GetUsersAsync(); // Causes double render
        StateHasChanged(); // Manual call = code smell
    }
}
```

## State Management

- **Cascading parameters** for passing values down the component tree (theme, auth state).
- **Scoped services** (registered with `AddScoped`) share state within a circuit (Server) or tab (WASM).
- For complex state, use a dedicated state container service injected via DI.
- DO NOT call `StateHasChanged()` manually unless you are handling an external event (timer, event bus). Blazor calls it automatically after UI events and lifecycle methods.

```csharp
// DO — state container service
public class CartState
{
    public List<CartItem> Items { get; private set; } = new();
    public event Action? OnChange;

    public void AddItem(CartItem item)
    {
        Items.Add(item);
        OnChange?.Invoke();
    }
}

// Register as scoped
builder.Services.AddScoped<CartState>();

// Consume in component
@inject CartState Cart
@implements IDisposable

@code {
    protected override void OnInitialized() => Cart.OnChange += StateHasChanged;
    public void Dispose() => Cart.OnChange -= StateHasChanged;
}
```

## Component Design

- One component per `.razor` file. Keep components focused — extract when a file exceeds ~100 lines.
- Use `[Parameter]` for inputs, `EventCallback<T>` for outputs.
- DO NOT mark services as `[Parameter]`. Use `@inject` for dependency injection.

```razor
@* DO — parameter + event callback *@
<UserCard User="@user" OnSelected="HandleUserSelected" />

@code {
    [Parameter, EditorRequired] public User User { get; set; } = default!;
    [Parameter] public EventCallback<string> OnSelected { get; set; }

    private async Task HandleClick() => await OnSelected.InvokeAsync(User.Id);
}
```

## JavaScript Interop

- Use `IJSRuntime` for calling JavaScript from Blazor. Prefer `InvokeVoidAsync` when no return value is needed.
- DO NOT call JS interop in `OnInitializedAsync` — the DOM is not ready. Use `OnAfterRenderAsync(firstRender: true)`.
- Minimize interop calls. Batch operations into a single JS function rather than calling JS in a loop.

```csharp
// DO — JS interop after render
@inject IJSRuntime JS

protected override async Task OnAfterRenderAsync(bool firstRender)
{
    if (firstRender)
    {
        await JS.InvokeVoidAsync("initializeChart", chartElement);
    }
}

// DON'T — JS interop during initialization (DOM not ready)
protected override async Task OnInitializedAsync()
{
    await JS.InvokeVoidAsync("initializeChart", chartElement); // Throws
}
```

## Forms and Validation

- Use `EditForm` with `DataAnnotationsValidator` for standard validation.
- Use `FluentValidation` for complex validation rules.
- Bind with `@bind-Value` on `InputText`, `InputNumber`, etc. — not raw HTML `<input>` elements.

## Common Footguns

- **Synchronous JS interop in WASM**: `IJSRuntime.Invoke<T>` (synchronous) is only available in WASM and blocks the single thread. Always use `InvokeAsync`.
- **Large WASM download size**: The full .NET runtime downloads to the browser. Use lazy loading (`LazyAssemblyLoader`), AOT compilation, and tree-shaking to reduce payload.
- **SignalR disconnects (Server)**: Network interruptions kill the circuit. Implement reconnection UI and graceful state recovery. Test with network throttling.
- **StateHasChanged from non-UI thread**: Calling `StateHasChanged()` from a background thread throws. Use `InvokeAsync(StateHasChanged)` to marshal back to the render thread.
- **Cascading parameter overuse**: Every cascading value change re-renders all consuming components in the subtree. Use for truly global state (theme, auth), not for frequently changing data.
- **Missing `@key` on list items**: Without `@key`, Blazor uses index-based diffing. Add `@key="item.Id"` to preserve component state during list reordering.

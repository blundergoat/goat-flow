# Swift + SwiftUI / UIKit Coding Standards

Reference for generating `ai/instructions/frontend.md` in iOS projects.

## SwiftUI State and Observation

- For iOS 17+ / macOS 14+ new code, prefer the Observation framework:
  `@Observable` models, `@State` for owned models, `@Bindable` for editable
  child access, and `@Environment(Type.self)` for shared dependencies.
- Keep `ObservableObject`, `@StateObject`, `@ObservedObject`, and
  `@EnvironmentObject` for older deployment targets or existing codebases that
  already use Combine-based observation.
- `@Binding` remains the right tool for child views that edit a parent's simple
  value state.

```swift
// DO — Observation-based ownership
@Observable
final class ProfileModel {
    var user: User
    var isEditing = false

    init(user: User) {
        self.user = user
    }
}

struct ProfileView: View {
    @State private var model = ProfileModel(user: .mock)

    var body: some View {
        ProfileEditor(model: model)
    }
}

struct ProfileEditor: View {
    @Bindable var model: ProfileModel

    var body: some View {
        Toggle("Editing", isOn: $model.isEditing)
    }
}

// DON'T — recreate owned legacy observable state on every render
struct ProfileView: View {
    @ObservedObject var viewModel = ProfileViewModel()
}
```

## MVVM Pattern

- One view model or observable model per screen/feature. Use `@Observable` for
  modern targets, `ObservableObject` for older targets.
- View models handle business logic, data fetching, and state. Views only render and forward user actions.
- DO NOT put networking or database code directly in views.

```swift
// DO — iOS 17+ @Observable
@Observable
class UserListViewModel {
    var users: [User] = []
    var isLoading = false
    var error: Error?

    func loadUsers() async {
        isLoading = true
        defer { isLoading = false }
        do {
            users = try await userService.fetchUsers()
        } catch {
            self.error = error
        }
    }
}

// DO — pre-iOS 17
class UserListViewModel: ObservableObject {
    @Published var users: [User] = []
    @Published var isLoading = false
}
```

## Navigation

- Use `NavigationStack` (iOS 16+) with type-safe navigation paths. `NavigationView` is deprecated.
- Define routes as an enum for type safety. Use `.navigationDestination(for:)` to map routes to views.

```swift
// DO — type-safe navigation
enum Route: Hashable {
    case userDetail(User)
    case settings
}

struct RootView: View {
    @State private var path = NavigationPath()

    var body: some View {
        NavigationStack(path: $path) {
            UserListView()
                .navigationDestination(for: Route.self) { route in
                    switch route {
                    case .userDetail(let user): UserDetailView(user: user)
                    case .settings: SettingsView()
                    }
                }
        }
    }
}
```

## Concurrency

- Use `async`/`await` for all asynchronous work. GCD (`DispatchQueue`) is legacy.
- Mark view model methods that update UI state with `@MainActor`.
- Use `.task` for view-driven async work so SwiftUI can cancel it when the view
  disappears or the task identity changes.

```swift
// DO — structured concurrency
struct UserListView: View {
    @State private var viewModel = UserListViewModel()

    var body: some View {
        List(viewModel.users) { user in
            Text(user.name)
        }
        .task {
            await viewModel.loadUsers()
        }
    }
}

// DON'T — unstructured GCD
DispatchQueue.global().async {
    let users = fetchUsers()
    DispatchQueue.main.async {
        self.users = users
    }
}
```

## Testing

- Use **XCTest** for unit and integration tests.
- Test view models independently — they are plain Swift classes with no UI dependency.
- Use **ViewInspector** for SwiftUI view testing when needed, but prefer testing the view model.
- Use `XCTestExpectation` or async test methods for async code.

```swift
// DO — test the view model
func testLoadUsers() async {
    let viewModel = UserListViewModel(service: MockUserService(users: mockUsers))
    await viewModel.loadUsers()
    XCTAssertEqual(viewModel.users.count, 3)
    XCTAssertFalse(viewModel.isLoading)
}
```

## Common Footguns

- **Main thread violations**: Updating `@Published` properties from a background thread crashes. Use `@MainActor` on the view model class or on individual methods.
- **Observation mismatch**: Mixing Observation (`@Observable`) and legacy
  `ObservableObject` wrappers in the same feature makes ownership rules hard to
  follow. Pick one model per feature boundary.
- **Retain cycles**: Closures capturing `self` in `ObservableObject` subclasses. Use `[weak self]` in escaping closures and completion handlers.
- **Legacy object ownership**: When supporting older OS targets, use
  `@StateObject` for view-owned `ObservableObject` instances and
  `@ObservedObject` for injected ones.
- **body recomputation**: The `body` property is called frequently. Never perform expensive work (network calls, heavy computation) inside `body`. Use `.task` or `.onAppear`.
- **ForEach without stable IDs**: `ForEach(items, id: \.self)` on non-unique values causes rendering bugs. Always use a stable, unique identifier.
- **Large @Observable classes**: A single `@Observable` with 20 properties causes unnecessary re-renders. Split into focused view models per screen.

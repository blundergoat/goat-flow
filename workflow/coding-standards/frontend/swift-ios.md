# Swift + SwiftUI / UIKit Coding Standards

Reference for generating `ai/instructions/frontend.md` in iOS projects.

## SwiftUI State Management

- `@State` for private, view-local state. Owned by the view, never passed in from outside.
- `@Binding` for child views that need to read and write a parent's state.
- `@ObservedObject` for injected view models. The parent owns the instance.
- `@StateObject` for view models the view itself creates. Use this when the view is the owner.
- `@EnvironmentObject` for dependency-injected shared state across the view tree.

```swift
// DO — clear ownership
struct ProfileView: View {
    @StateObject private var viewModel = ProfileViewModel()

    var body: some View {
        VStack {
            Text(viewModel.user.name)
            EditButton(isEditing: $viewModel.isEditing)
        }
    }
}

struct EditButton: View {
    @Binding var isEditing: Bool

    var body: some View {
        Button(isEditing ? "Done" : "Edit") {
            isEditing.toggle()
        }
    }
}

// DON'T — @ObservedObject for owned state (recreated on re-render)
struct ProfileView: View {
    @ObservedObject var viewModel = ProfileViewModel() // WRONG: loses state
}
```

## MVVM Pattern

- One `ViewModel` per screen/feature. View models are `@Observable` (iOS 17+) or `ObservableObject`.
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
- Use `Task` in views to launch async work from synchronous contexts (`.task` modifier preferred).

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
- **Retain cycles**: Closures capturing `self` in `ObservableObject` subclasses. Use `[weak self]` in escaping closures and completion handlers.
- **@StateObject vs @ObservedObject**: Using `@ObservedObject` for a view-created instance causes state loss on re-render. Use `@StateObject` for owned instances.
- **body recomputation**: The `body` property is called frequently. Never perform expensive work (network calls, heavy computation) inside `body`. Use `.task` or `.onAppear`.
- **ForEach without stable IDs**: `ForEach(items, id: \.self)` on non-unique values causes rendering bugs. Always use a stable, unique identifier.
- **Large @Observable classes**: A single `@Observable` with 20 properties causes unnecessary re-renders. Split into focused view models per screen.

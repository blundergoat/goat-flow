# Flutter / Dart Coding Standards

Reference for generating `ai/instructions/frontend.md` in Flutter projects.

## Widget Composition

- Prefer `StatelessWidget` by default. Only use `StatefulWidget` when the widget owns local, ephemeral state (animations, text editing controllers, form state).
- For all other state, use a state management solution. `StatefulWidget` is not a state management strategy.
- Extract widgets when a `build` method exceeds ~40 lines. Extract into a new widget class, not a method — methods don't get their own `BuildContext` or lifecycle.

```dart
// DO — stateless widget, state managed externally
class UserCard extends StatelessWidget {
  const UserCard({super.key, required this.user, required this.onTap});

  final User user;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Text(user.name),
    );
  }
}

// DON'T — StatefulWidget for state that belongs in a provider
class UserCard extends StatefulWidget { /* manages fetched user data in State */ }

// DON'T — extract build logic into methods
Widget _buildHeader() { ... } // No independent rebuild, no own BuildContext
```

## State Management

- **Riverpod** (recommended): Compile-safe, testable, no `BuildContext` dependency for providers.
- **Provider**: Acceptable if already in the codebase. Do not mix Provider and Riverpod.
- **BLoC**: Suitable for complex event-driven state. Adds boilerplate — use only when streams are genuinely needed.
- DO NOT use `setState` for anything beyond ephemeral UI state (toggle, animation progress).

```dart
// DO — Riverpod provider
@riverpod
Future<List<User>> users(UsersRef ref) async {
  final repo = ref.watch(userRepositoryProvider);
  return repo.getUsers();
}

// DO — consuming in a widget
class UserListScreen extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final usersAsync = ref.watch(usersProvider);
    return usersAsync.when(
      data: (users) => ListView.builder(
        itemCount: users.length,
        itemBuilder: (_, i) => UserCard(user: users[i]),
      ),
      loading: () => const CircularProgressIndicator(),
      error: (e, _) => Text('Error: $e'),
    );
  }
}
```

## Navigation

- Use **GoRouter** for declarative, type-safe routing.
- Define routes as constants or an enum. Use path parameters for IDs, query parameters for filters.
- Use `context.go` for replacement navigation, `context.push` for stack navigation.

```dart
// DO — GoRouter with type-safe routes
final router = GoRouter(
  routes: [
    GoRoute(path: '/', builder: (_, __) => const HomeScreen()),
    GoRoute(
      path: '/users/:id',
      builder: (_, state) => UserDetailScreen(
        userId: state.pathParameters['id']!,
      ),
    ),
  ],
);

// Navigate
context.push('/users/${user.id}');
```

## Platform Channels

- Use platform channels (`MethodChannel`) only when no pub.dev package exists for the native functionality.
- Define the channel contract (method names, argument types) in a shared document or code-generated binding.
- Handle `MissingPluginException` gracefully — it occurs when running on unsupported platforms.

## Testing

- **Unit tests**: Test business logic, providers, and repositories. No Flutter dependency needed.
- **Widget tests**: Test UI rendering and interaction with `testWidgets` and `WidgetTester`.
- **Golden tests**: Screenshot comparison for visual regression. Use `matchesGoldenFile`.
- **Integration tests**: Full app tests with `integration_test` package. Run on real devices or emulators.

```dart
// DO — widget test
testWidgets('UserCard displays name and handles tap', (tester) async {
  var tapped = false;
  await tester.pumpWidget(MaterialApp(
    home: UserCard(user: mockUser, onTap: () => tapped = true),
  ));

  expect(find.text('Ada Lovelace'), findsOneWidget);
  await tester.tap(find.byType(UserCard));
  expect(tapped, isTrue);
});

// DO — provider unit test (Riverpod)
test('usersProvider fetches users', () async {
  final container = ProviderContainer(overrides: [
    userRepositoryProvider.overrideWithValue(FakeUserRepository()),
  ]);
  final users = await container.read(usersProvider.future);
  expect(users.length, 3);
});
```

## Common Footguns

- **Build method performance**: Expensive computation in `build()` runs on every rebuild. Compute in the state layer, not the widget.
- **`setState` in complex widgets**: `setState` rebuilds the entire `StatefulWidget` subtree. For complex UIs, this causes jank. Use Riverpod/BLoC to target rebuilds.
- **`const` constructors**: Missing `const` on stateless widgets means Flutter recreates them unnecessarily. Always use `const` constructors when possible.
- **Context after async gaps**: Using `BuildContext` after an `await` may reference a disposed widget. Check `mounted` before using context after async operations.
- **Unbounded lists in Column/Row**: Putting a `ListView` inside a `Column` without `Expanded` or `SizedBox` constraints causes an unbounded height error. Always constrain scrollable children.
- **Forgetting `dispose`**: `TextEditingController`, `AnimationController`, `ScrollController`, and `StreamSubscription` must be disposed. Leaking them causes memory issues and stale listeners.

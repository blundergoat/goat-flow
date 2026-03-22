# Kotlin + Jetpack Compose / Android Coding Standards

Reference for generating `ai/instructions/frontend.md` in Android projects using Jetpack Compose.

## Compose State

- Use `remember` + `mutableStateOf` for local UI state within a composable.
- Use `rememberSaveable` for state that must survive configuration changes (screen rotation).
- State hoisting: composables that display state should receive it as parameters and emit events. The parent owns the state.

```kotlin
// DO — hoisted state
@Composable
fun Counter(count: Int, onIncrement: () -> Unit) {
    Button(onClick = onIncrement) {
        Text("Count: $count")
    }
}

@Composable
fun CounterScreen() {
    var count by remember { mutableStateOf(0) }
    Counter(count = count, onIncrement = { count++ })
}

// DON'T — state buried inside the display component
@Composable
fun Counter() {
    var count by remember { mutableStateOf(0) } // Can't be controlled by parent
    Button(onClick = { count++ }) { Text("Count: $count") }
}
```

## ViewModel and State

- One `ViewModel` per screen. Expose UI state as `StateFlow` from the ViewModel.
- Use `MutableStateFlow` internally, expose `StateFlow` publicly (read-only).
- Collect flows in composables with `collectAsStateWithLifecycle()` — it stops collection when the UI is not visible.

```kotlin
// DO
class UserListViewModel(private val repo: UserRepository) : ViewModel() {
    private val _uiState = MutableStateFlow(UserListUiState())
    val uiState: StateFlow<UserListUiState> = _uiState.asStateFlow()

    fun loadUsers() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            val users = repo.getUsers()
            _uiState.update { it.copy(users = users, isLoading = false) }
        }
    }
}

@Composable
fun UserListScreen(viewModel: UserListViewModel = viewModel()) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    // render uiState
}

// DON'T — expose MutableStateFlow or use LiveData in new code
val users = MutableStateFlow<List<User>>(emptyList()) // Mutable exposed!
```

## Navigation

- Use `NavHost` + `NavController` from the Navigation Compose library.
- Define routes as a sealed class or sealed interface for type safety.
- DO NOT pass complex objects as navigation arguments. Pass IDs, load data in the destination's ViewModel.

```kotlin
// DO — type-safe routes
sealed class Screen(val route: String) {
    data object UserList : Screen("users")
    data class UserDetail(val userId: String) : Screen("users/{userId}")
}

NavHost(navController = navController, startDestination = Screen.UserList.route) {
    composable(Screen.UserList.route) {
        UserListScreen(onUserClick = { id -> navController.navigate("users/$id") })
    }
    composable("users/{userId}") { backStackEntry ->
        val userId = backStackEntry.arguments?.getString("userId") ?: return@composable
        UserDetailScreen(userId = userId)
    }
}
```

## Coroutines

- Use `viewModelScope` for ViewModel-scoped work. It cancels automatically when the ViewModel clears.
- Use `lifecycleScope` in Activities/Fragments only when necessary. Prefer `LaunchedEffect` in Compose.
- Use `LaunchedEffect` for side effects in composables. The key controls when it re-launches.

```kotlin
// DO — LaunchedEffect with proper key
@Composable
fun UserDetailScreen(userId: String) {
    val viewModel: UserDetailViewModel = viewModel()
    LaunchedEffect(userId) {
        viewModel.loadUser(userId)
    }
}

// DON'T — LaunchedEffect(Unit) for data that depends on a parameter
LaunchedEffect(Unit) { viewModel.loadUser(userId) } // Won't reload when userId changes
```

## Testing

- **Compose tests**: Use `createComposeRule()` and `onNodeWithText`, `onNodeWithContentDescription`, `performClick`.
- **ViewModel tests**: Test with JUnit + kotlinx-coroutines-test. Use `runTest` for coroutine testing.
- **Flow testing**: Use **Turbine** for testing StateFlow/SharedFlow emissions.

```kotlin
// DO — Compose UI test
@get:Rule val composeTestRule = createComposeRule()

@Test
fun counterDisplaysAndIncrements() {
    composeTestRule.setContent { CounterScreen() }
    composeTestRule.onNodeWithText("Count: 0").assertIsDisplayed()
    composeTestRule.onNodeWithText("Count: 0").performClick()
    composeTestRule.onNodeWithText("Count: 1").assertIsDisplayed()
}

// DO — ViewModel test with Turbine
@Test
fun loadUsersEmitsState() = runTest {
    val viewModel = UserListViewModel(FakeUserRepository())
    viewModel.uiState.test {
        assertEquals(UserListUiState(), awaitItem())
        viewModel.loadUsers()
        assertEquals(UserListUiState(isLoading = true), awaitItem())
        assertEquals(UserListUiState(users = fakeUsers, isLoading = false), awaitItem())
    }
}
```

## Common Footguns

- **Recomposition performance**: Composables recompose when their inputs change. Avoid allocating objects (lambdas, lists) inside composables without `remember`. Use `derivedStateOf` for expensive computations.
- **Context leaks**: Storing `Activity` context in a ViewModel or singleton outlives the Activity and leaks memory. Use `applicationContext` for long-lived references.
- **LaunchedEffect key misuse**: `LaunchedEffect(Unit)` runs once and never re-triggers. If the effect depends on a parameter, that parameter must be the key.
- **Collecting flows without lifecycle awareness**: `collectAsState()` collects even when the app is in the background. Use `collectAsStateWithLifecycle()` to stop collection when the lifecycle is below STARTED.
- **Unstable parameters causing recomposition**: Data classes with mutable properties or list parameters without `@Immutable`/`@Stable` annotations trigger unnecessary recompositions. Use immutable data classes and `kotlinx.collections.immutable`.

# React Coding Standards (TypeScript-First)

Reference for generating `ai/instructions/frontend.md` in React projects.
Assume TypeScript for new code; if the project is JavaScript-only, keep the same
component, state, and testing rules and drop the type syntax.

## Toolchain Gates

- `useEffectEvent` is only available on newer React toolchains. If the repo is
  not on a version that supports it, use refs or stable callbacks instead.
- React Compiler guidance only applies if the repo actually enables the compiler
  in its build toolchain. Do not assume it is present.
- Loader/server-component guidance is framework-specific. Only include it when
  the repo actually uses Next.js, Remix, or React Router data APIs.

## Component Patterns

- Use function components exclusively. Class components are legacy only.
- DO NOT use `React.FC` — it adds implicit `children` and breaks generics.
- Type props with an interface, colocated above the component.

```tsx
// DO
interface UserCardProps {
  user: User;
  onSelect: (id: string) => void;
}

function UserCard({ user, onSelect }: UserCardProps) {
  return <button onClick={() => onSelect(user.id)}>{user.name}</button>;
}

// DON'T
const UserCard: React.FC<{ user: User }> = ({ user }) => { ... };
```

- Default to one exported component per file. Small private helper components
  may stay colocated when that makes the feature easier to read.
- Extract subcomponents when a render block exceeds ~50 lines, not before.

## State Management

- **Local UI state**: `useState`. Colocate state with the component that owns it.
- **Server state / route data**: Prefer the framework's loader/actions model
  (Next.js, Remix, React Router data APIs). If the app is client-rendered, use
  a cache library already adopted by the project, such as TanStack Query or SWR.
- **Global client state**: Start with context for stable dependencies and lift
  state only when needed. Add a dedicated store only when cross-feature writes
  become hard to model with composition alone.
- Lift state up only when two siblings need the same data. Prefer composition over context for avoiding prop drilling.

```tsx
// DO — server state with an existing query/cache layer
const { data: users, isLoading } = useQuery({ queryKey: ['users'], queryFn: fetchUsers });

// DON'T — manual fetch into useState
const [users, setUsers] = useState<User[]>([]);
useEffect(() => { fetchUsers().then(setUsers); }, []);
```

## Hooks

- Custom hooks for any shared logic: `useDebounce`, `useMediaQuery`, `useAuth`.
- DO NOT use `useEffect` for data fetching when a loader, server component, or
  query/cache layer can own the request lifecycle.
- `useEffect` is for synchronizing with external systems (DOM APIs, timers, subscriptions). If you are transforming data for rendering, derive it during render instead.
- Every custom hook starts with `use` and lives in `hooks/` or colocated with its feature.
- Use `useEffectEvent` or a ref when an effect needs the latest callback/value
  without re-subscribing on every render.

```tsx
// DO — derived state calculated during render
const activeUsers = users.filter(u => u.isActive);

// DON'T — useEffect to derive state
const [activeUsers, setActiveUsers] = useState<User[]>([]);
useEffect(() => { setActiveUsers(users.filter(u => u.isActive)); }, [users]);
```

## Performance

- DO NOT preemptively wrap components in `React.memo`. Measure first with React DevTools Profiler.
- If React Compiler is enabled, lean on the compiler first. Add manual
  `useMemo`, `useCallback`, or `React.memo` only for measured hot paths or
  explicit referential-stability boundaries.
- Use `startTransition` or `useDeferredValue` for non-urgent updates such as
  filtering large lists or typeahead results.
- For expensive list rendering, virtualize with `@tanstack/react-virtual` or `react-window`.
- Use `React.lazy` + `Suspense` for route-level code splitting.

## Testing

- Use `@testing-library/react`. Test behavior, not implementation details.
- Use `userEvent.setup()` over `fireEvent` for most interactions — it simulates
  real browser behavior more accurately.
- DO NOT test internal state. Test what the user sees and does.
- Query priority: `getByRole` > `getByLabelText` > `getByText` > `getByTestId`.

```tsx
// DO — test behavior
const user = userEvent.setup();
await user.click(screen.getByRole('button', { name: /submit/i }));
expect(screen.getByText('Order confirmed')).toBeInTheDocument();

// DON'T — test implementation
expect(component.state.isSubmitted).toBe(true);
```

## File Structure

- Colocate tests next to source: `UserCard.tsx` + `UserCard.test.tsx`.
- Avoid broad barrel exports in app code unless the project already uses
  intentional package-boundary barrels. They can hurt tree-shaking and create
  circular dependency traps when added casually.
- Group by feature, not by type: `features/users/UserCard.tsx`, not `components/UserCard.tsx`.

## Common Footguns

- **Stale closures**: Values captured in event handlers or effects can be stale.
  Use `useEffectEvent` or refs for latest-value access in subscriptions and
  timers.
- **Dependency arrays**: Missing deps cause stale data. Unnecessary deps cause infinite loops. The linter is correct — fix the design, don't suppress the warning.
- **Key prop misuse**: Keys must be stable and unique. Never use array index as key for reorderable lists. Never use `Math.random()`.
- **Duplicated state**: Storing derived data in `useState` creates sync bugs and
  extra renders. Derive during render unless the value must survive independently.
- **Uncontrolled-to-controlled**: Initializing `useState(undefined)` then setting a value flips an input from uncontrolled to controlled. Initialize with empty string for text inputs.
- **Object/array literals in JSX**: `style={{ color: 'red' }}` creates a new object every render. Hoist to a constant or use CSS.

## Primary Sources

- React docs: https://react.dev/
- Effects guidance: https://react.dev/learn/you-might-not-need-an-effect
- React Compiler: https://react.dev/learn/react-compiler

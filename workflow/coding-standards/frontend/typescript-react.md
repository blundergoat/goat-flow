# TypeScript + React Coding Standards

Reference for generating `ai/instructions/frontend.md` in React projects.

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

- One component per file. File name matches component name: `UserCard.tsx`.
- Extract subcomponents when a render block exceeds ~50 lines, not before.

## State Management

- **Local UI state**: `useState`. Colocate state with the component that owns it.
- **Server state**: TanStack Query (or SWR). Never store fetched data in `useState`.
- **Global client state**: Zustand or Jotai. Avoid Redux unless already adopted.
- Lift state up only when two siblings need the same data. Prefer composition over context for avoiding prop drilling.

```tsx
// DO — server state with TanStack Query
const { data: users, isLoading } = useQuery({ queryKey: ['users'], queryFn: fetchUsers });

// DON'T — manual fetch into useState
const [users, setUsers] = useState<User[]>([]);
useEffect(() => { fetchUsers().then(setUsers); }, []);
```

## Hooks

- Custom hooks for any shared logic: `useDebounce`, `useMediaQuery`, `useAuth`.
- DO NOT use `useEffect` for data fetching — use TanStack Query or a data loader.
- `useEffect` is for synchronizing with external systems (DOM APIs, timers, subscriptions). If you are transforming data for rendering, derive it during render instead.
- Every custom hook starts with `use` and lives in `hooks/` or colocated with its feature.

```tsx
// DO — derived state calculated during render
const activeUsers = users.filter(u => u.isActive);

// DON'T — useEffect to derive state
const [activeUsers, setActiveUsers] = useState<User[]>([]);
useEffect(() => { setActiveUsers(users.filter(u => u.isActive)); }, [users]);
```

## Performance

- DO NOT preemptively wrap components in `React.memo`. Measure first with React DevTools Profiler.
- `useMemo` and `useCallback` add complexity. Use them when a component re-renders expensively or when a referentially stable value is needed for a dependency array.
- For expensive list rendering, virtualize with `@tanstack/react-virtual` or `react-window`.
- Use `React.lazy` + `Suspense` for route-level code splitting.

## Testing

- Use `@testing-library/react`. Test behavior, not implementation details.
- Use `userEvent` over `fireEvent` — it simulates real browser interactions.
- DO NOT test internal state. Test what the user sees and does.
- Query priority: `getByRole` > `getByLabelText` > `getByText` > `getByTestId`.

```tsx
// DO — test behavior
await userEvent.click(screen.getByRole('button', { name: /submit/i }));
expect(screen.getByText('Order confirmed')).toBeInTheDocument();

// DON'T — test implementation
expect(component.state.isSubmitted).toBe(true);
```

## File Structure

- Colocate tests next to source: `UserCard.tsx` + `UserCard.test.tsx`.
- DO NOT use barrel exports (`index.ts` re-exporting everything). They break tree-shaking and create circular dependency traps.
- Group by feature, not by type: `features/users/UserCard.tsx`, not `components/UserCard.tsx`.

## Common Footguns

- **Stale closures**: Values captured in event handlers or effects can be stale. Use refs for latest-value access in intervals/subscriptions.
- **Dependency arrays**: Missing deps cause stale data. Unnecessary deps cause infinite loops. The linter is correct — fix the design, don't suppress the warning.
- **Key prop misuse**: Keys must be stable and unique. Never use array index as key for reorderable lists. Never use `Math.random()`.
- **Uncontrolled-to-controlled**: Initializing `useState(undefined)` then setting a value flips an input from uncontrolled to controlled. Initialize with empty string for text inputs.
- **Object/array literals in JSX**: `style={{ color: 'red' }}` creates a new object every render. Hoist to a constant or use CSS.

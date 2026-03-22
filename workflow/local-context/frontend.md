# Prompt: Create ai/instructions/frontend.md

Example domain overlay for a React/TypeScript frontend. Adapt to your actual stack.

---

## The Prompt

Read the frontend codebase, then write `ai/instructions/frontend.md`:

```
# Frontend Instructions (React + TypeScript)

## Component Patterns

Use functional components with hooks. No class components.

```tsx
// Good — named export, props typed inline for small components
export function UserAvatar({ name, size = 32 }: { name: string; size?: number }) {
  return <img src={`/avatars/${name}.png`} width={size} alt={name} />;
}

// Good — separate Props type when 3+ props
interface UserCardProps {
  user: User;
  onEdit: (id: string) => void;
  showActions: boolean;
}

export function UserCard({ user, onEdit, showActions }: UserCardProps) {
  // ...
}
```

DON'T: Use `React.FC`. It adds implicit `children` and doesn't help with generics.

## State Management

- Local UI state: `useState` / `useReducer`
- Server state: TanStack Query (`useQuery`, `useMutation`). No manual `useEffect` for fetching.
- Global app state: Zustand store in `src/stores/`. One store per domain.

```tsx
// Good — server state via TanStack Query
function UserList() {
  const { data: users, isLoading } = useQuery({
    queryKey: ["users"],
    queryFn: () => api.users.list(),
  });
}

// Bad — manual fetch in useEffect
function UserList() {
  const [users, setUsers] = useState([]);
  useEffect(() => {
    fetch("/api/users").then(r => r.json()).then(setUsers);
  }, []);
}
```

## API Client

All API calls go through the generated client in `src/lib/api.ts`.
Never call `fetch()` directly in components.

```tsx
// Good
import { api } from "@/lib/api";
const users = await api.users.list({ page: 1 });

// Bad
const res = await fetch("/api/users?page=1");
```

## Styling

Use Tailwind CSS utility classes. No CSS modules, no styled-components.

```tsx
// Good
<button className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700">
  Save
</button>

// Bad — don't create wrapper components for single-use styles
const StyledButton = styled.button`background: blue;`;
```

Extract repeated class sets into components, not utility functions.

## Testing

Use Vitest + Testing Library. Test behavior, not implementation.

```tsx
// Good — tests what the user sees
test("shows error when email is invalid", async () => {
  render(<SignupForm />);
  await userEvent.type(screen.getByLabelText("Email"), "not-an-email");
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));
  expect(screen.getByText("Enter a valid email")).toBeVisible();
});

// Bad — tests implementation details
test("sets error state", () => {
  const { result } = renderHook(() => useSignupForm());
  act(() => result.current.setEmail("bad"));
  expect(result.current.errors.email).toBe(true);
});
```

Co-locate test files: `UserCard.tsx` and `UserCard.test.tsx` in the same directory.
```

Replace the libraries, paths, and patterns above with what this project actually uses.

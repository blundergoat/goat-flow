# TypeScript + SvelteKit Coding Standards

Reference for generating `ai/instructions/frontend.md` in Svelte/SvelteKit projects.

## Runes (Svelte 5+)

- Use runes for all new code: `$state`, `$derived`, `$effect`.
- DO NOT use legacy reactive syntax (`$:`, `let` with reactive assignments) in new code.
- `$effect` is for side effects only (DOM manipulation, logging, external subscriptions). If you are computing a value, use `$derived`.

```svelte
<script lang="ts">
  // DO — runes
  let count = $state(0);
  let doubled = $derived(count * 2);

  $effect(() => {
    document.title = `Count: ${count}`;
  });

  // DON'T — legacy reactive syntax in new code
  let count = 0;
  $: doubled = count * 2;
</script>
```

## Props and Events

- Use `$props()` for typed component inputs.
- Use callback props for child-to-parent communication, not custom events.

```svelte
<script lang="ts">
  interface Props {
    user: User;
    onSelect: (id: string) => void;
  }

  let { user, onSelect }: Props = $props();
</script>

<button onclick={() => onSelect(user.id)}>{user.name}</button>
```

## Data Loading

- Use SvelteKit `load` functions in `+page.ts` / `+page.server.ts` for data fetching. Never fetch in `$effect` or `onMount` for initial page data.
- Server load functions (`+page.server.ts`) for data that needs secrets, DB access, or should not be exposed to the client.
- Universal load functions (`+page.ts`) for data fetched from public APIs.
- Use form actions (`+page.server.ts` `actions`) for mutations, not API endpoints.

```typescript
// DO — +page.server.ts
export const load: PageServerLoad = async ({ params, locals }) => {
  const user = await locals.db.user.findUnique({ where: { id: params.id } });
  if (!user) throw error(404, 'User not found');
  return { user };
};

// DO — form action for mutations
export const actions = {
  update: async ({ request, locals }) => {
    const data = await request.formData();
    await locals.db.user.update({ where: { id: data.get('id') }, data: { name: data.get('name') } });
    return { success: true };
  }
};
```

## State Management

- Local state: `$state` inside the component.
- Shared state across components: Svelte stores (`writable`, `readable`) or module-level `$state` in a `.svelte.ts` file.
- For complex apps, create context with `setContext`/`getContext` for dependency-injected state.

```typescript
// DO — shared state in a .svelte.ts module
// lib/stores/cart.svelte.ts
let items = $state<CartItem[]>([]);

export function addItem(item: CartItem) { items.push(item); }
export function getItems() { return items; }
```

## Testing

- Use **Vitest** + `@testing-library/svelte`.
- Test rendered output and user interactions, not component internals.
- Mock SvelteKit modules (`$app/navigation`, `$app/stores`) in test setup.

```typescript
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import UserCard from './UserCard.svelte';

test('emits select on click', async () => {
  const onSelect = vi.fn();
  render(UserCard, { props: { user: mockUser, onSelect } });
  await userEvent.click(screen.getByRole('button'));
  expect(onSelect).toHaveBeenCalledWith(mockUser.id);
});
```

## Common Footguns

- **SSR hydration mismatches**: Code that accesses `window`, `document`, or `localStorage` during SSR will fail. Guard with `browser` from `$app/environment` or run in `onMount`.
- **Load function waterfalls**: Sequential `await` calls in load functions serialize requests. Use `Promise.all` for independent fetches.
```typescript
// SLOW — waterfall
const users = await fetch('/api/users').then(r => r.json());
const posts = await fetch('/api/posts').then(r => r.json());

// FAST — parallel
const [users, posts] = await Promise.all([
  fetch('/api/users').then(r => r.json()),
  fetch('/api/posts').then(r => r.json()),
]);
```
- **Mutating $state arrays**: Direct index assignment (`items[0] = x`) is reactive with runes. But `.sort()` and `.reverse()` mutate in place — reassign to trigger updates if needed.
- **Missing error pages**: Without `+error.svelte`, errors show a blank page in production. Always create error boundaries at the layout level.
- **Forgetting to invalidate**: After a form action mutates data, dependent load functions re-run automatically. But `fetch` calls from the client need explicit `invalidate()` or `invalidateAll()`.

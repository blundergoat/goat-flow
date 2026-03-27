# Vue 3 Coding Standards (TypeScript-First)

Reference for generating `ai/instructions/frontend.md` in Vue projects.
Assume TypeScript for new code; if the project is JavaScript-only, keep the same
Composition API, state, and testing rules and drop the type syntax.

## Composition API

- Use `<script setup lang="ts">` for all new components. Options API is legacy only.
- One component per file. File name matches component: `UserCard.vue`.

```vue
<!-- DO -->
<script setup lang="ts">
import { ref, computed } from 'vue';

interface Props {
  userId: string;
  label?: string;
}

const props = withDefaults(defineProps<Props>(), {
  label: 'Default',
});
const emit = defineEmits<{ select: [id: string] }>();

const isActive = ref(false);
const displayLabel = computed(() => props.label);
</script>

<!-- DON'T — Options API in new code -->
<script lang="ts">
export default defineComponent({
  props: { userId: String },
  data() { return { isActive: false }; }
});
</script>
```

## State Management

- **Local state**: `ref()` for primitives, `reactive()` for objects. Prefer `ref()` by default — it has explicit `.value` which makes reactivity clear.
- **Shared state**: Pinia stores. One store per domain: `useUserStore`, `useCartStore`.
- **Composables**: Extract shared reactive logic into `composables/` files prefixed with `use`.

```ts
// DO — composable for shared logic
// composables/useDebounce.ts
import { ref, watch, type Ref } from 'vue';

export function useDebounce<T>(value: Ref<T>, delay: number): Ref<T> {
  const debounced = ref(value.value) as Ref<T>;
  let timeout: ReturnType<typeof setTimeout>;
  watch(value, (v) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => { debounced.value = v; }, delay);
  });
  return debounced;
}
```

## Props and Events

- Type props with TypeScript generics: `defineProps<Props>()`.
- Type emits with the tuple syntax: `defineEmits<{ change: [value: string] }>()`.
- Use `withDefaults()` for default values on optional props.
- Use `defineModel()` only when the component truly exposes a `v-model`
  contract. Prefer explicit props + emits for one-off events.
- DO NOT mutate props. Emit an event to the parent instead.

## Watchers

- `watchEffect` for side effects that depend on multiple reactive sources — it auto-tracks dependencies.
- `watch` for reacting to specific source changes, especially when you need the old value.
- DO NOT over-watch. If you can derive the value with `computed`, use `computed`.

```ts
// DO — derived state
const fullName = computed(() => `${first.value} ${last.value}`);

// DON'T — watcher to set derived state
watch([first, last], ([f, l]) => { fullName.value = `${f} ${l}`; });
```

## Testing

- Use **Vitest** as the test runner + `@vue/test-utils`.
- Prefer `mount` over `shallowMount` — shallow mounting hides integration bugs.
- Test user-visible behavior: rendered text, emitted events, slot content.
- Mock API calls at the network level (`msw`) not at the store level.
- Use `await flushPromises()` after async interactions that trigger suspense,
  router navigation, or network mocks.

```ts
// DO — test behavior
const wrapper = mount(UserCard, { props: { user: mockUser } });
await wrapper.find('button').trigger('click');
expect(wrapper.emitted('select')?.[0]).toEqual([mockUser.id]);
```

## Common Footguns

- **Reactivity loss from destructuring**: Destructuring a `reactive()` object strips reactivity. Use `toRefs()` or stick with `ref()`.
```ts
// BROKEN — loses reactivity
const { name, email } = reactive({ name: 'Ada', email: 'ada@example.com' });

// FIXED
const state = reactive({ name: 'Ada', email: 'ada@example.com' });
const { name, email } = toRefs(state);
```
- **Ref unwrapping gotcha**: Refs auto-unwrap in templates but not in `<script>`. Always use `.value` in script, never in templates.
- **Async in setup**: Top-level `await` in `<script setup>` compiles to
  `async setup()` and requires a `<Suspense>` boundary above the component. Use
  it deliberately; otherwise prefer `onMounted` or composables for async work.
- **v-if vs v-show**: `v-if` destroys and recreates DOM. `v-show` toggles CSS. Use `v-show` for frequently toggled elements, `v-if` for conditionally rendered blocks.
- **Template refs timing**: `ref` bound to a template element is `null` until the component mounts. Access it in `onMounted`, not during setup.

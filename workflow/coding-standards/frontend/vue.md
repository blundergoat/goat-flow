# Vue 3 Coding Standards (TypeScript-First)

Reference for generating `ai/instructions/frontend.md` in Vue projects.
Assume TypeScript for new code; if the project is JavaScript-only, keep the same
Composition API, state, and testing rules and drop the type syntax.

## Version Gates

- This file assumes Vue 3.
- `<script setup>`, typed `defineProps`, and modern composable patterns are Vue
  3 guidance.
- If the repo is still Vue 2, class-style, or Options API heavy, follow the
  existing project structure unless the team is already migrating that area.

## Composition API

- In Vue 3 repos that already use Composition API, prefer
  `<script setup lang="ts">` for new components.
- In Options API heavy repos, keep the local style consistent unless the change
  is part of an intentional migration.
- Default to one exported component per file. Small local helpers can stay in
  the same file when that keeps the feature easier to read.

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
- **Shared state**: Prefer the store library already adopted by the repo. In
  modern Vue 3 code that usually means Pinia; in older codebases it may still
  mean Vuex until the project migrates.
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

## Primary Sources

- Vue official guide: https://vuejs.org/guide/introduction.html
- `<script setup>` API: https://vuejs.org/api/sfc-script-setup.html
- Pinia docs: https://pinia.vuejs.org/

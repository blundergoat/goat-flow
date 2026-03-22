# React Native Coding Standards

Reference for generating `ai/instructions/frontend.md` in React Native projects.

## Platform-Specific Code

- Use `.ios.tsx` / `.android.tsx` file extensions for platform-divergent components. The bundler resolves them automatically.
- Use `Platform.select` or `Platform.OS` for small inline differences.
- DO NOT litter components with `Platform.OS === 'ios' ? ... : ...` checks. Extract to platform files or a utility.

```tsx
// DO — platform-specific files
// Button.ios.tsx — uses iOS-native feel
// Button.android.tsx — uses Material Design

// DO — small inline difference
import { Platform, StyleSheet } from 'react-native';

const styles = StyleSheet.create({
  shadow: Platform.select({
    ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1 },
    android: { elevation: 4 },
  }),
});

// DON'T — platform checks scattered throughout JSX
{Platform.OS === 'ios' ? <IOSHeader /> : <AndroidHeader />}
{Platform.OS === 'ios' ? styles.iosPadding : styles.androidPadding}
```

## Navigation

- Use **React Navigation** as the standard. Define navigators as typed TypeScript structures.
- Type all route params with a `RootStackParamList` for type-safe navigation.
- Use `useNavigation` and `useRoute` hooks. DO NOT prop-drill `navigation`.

```tsx
// DO — typed navigation
type RootStackParamList = {
  Home: undefined;
  UserDetail: { userId: string };
  Settings: undefined;
};

type UserDetailScreenProps = NativeStackScreenProps<RootStackParamList, 'UserDetail'>;

function UserDetailScreen({ route }: UserDetailScreenProps) {
  const { userId } = route.params;
  // ...
}
```

## State Management

- Same principles as React web: TanStack Query for server state, Zustand or Jotai for client state.
- Use `AsyncStorage` (or `MMKV` for performance) for persisted local data — never for sensitive data.
- Sensitive data (tokens, credentials) goes in the platform keychain: `react-native-keychain` or `expo-secure-store`.

## Styling

- Use `StyleSheet.create` for all styles. It validates at creation time and enables optimizations.
- DO NOT use inline style objects — they create new objects on every render.
- For design systems, use a theme object or a styling library (`nativewind`, `tamagui`, `styled-components/native`).

```tsx
// DO
const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  title: { fontSize: 18, fontWeight: '600' },
});

// DON'T
<View style={{ flex: 1, padding: 16 }}>
```

## Lists and Performance

- Use `FlashList` (from `@shopify/flash-list`) for large lists. It outperforms `FlatList` in most cases.
- For moderate lists, `FlatList` with proper `keyExtractor` and `getItemLayout` (if fixed height).
- DO NOT render large datasets in a `ScrollView` with `.map()` — it renders everything at once.
- Use `React.memo` on list item components to prevent unnecessary re-renders during scroll.

```tsx
// DO — FlashList for large lists
import { FlashList } from '@shopify/flash-list';

<FlashList
  data={users}
  renderItem={({ item }) => <UserCard user={item} />}
  estimatedItemSize={80}
  keyExtractor={item => item.id}
/>

// DON'T — ScrollView with map
<ScrollView>
  {users.map(user => <UserCard key={user.id} user={user} />)}
</ScrollView>
```

## Native Modules

- Prefer existing community libraries over writing custom native modules.
- When bridging is necessary, use **Turbo Modules** (New Architecture) over the legacy bridge.
- For Expo projects, use `expo-modules-api` for native module development.
- Keep native module interfaces minimal — expose only what JS needs.

## Testing

- Use **React Native Testing Library** (`@testing-library/react-native`).
- Test component behavior: rendered text, user interactions, callback invocations.
- Mock native modules in `jest.setup.js`. Common mocks: `react-native-reanimated`, `@react-navigation/native`.

```tsx
// DO — behavior test
import { render, screen, fireEvent } from '@testing-library/react-native';

test('navigates to detail on press', () => {
  const onPress = jest.fn();
  render(<UserCard user={mockUser} onPress={onPress} />);
  fireEvent.press(screen.getByText(mockUser.name));
  expect(onPress).toHaveBeenCalledWith(mockUser.id);
});
```

## Common Footguns

- **Bridge bottleneck**: Passing large JSON payloads over the old bridge is slow. Batch data, use Turbo Modules, or process on the native side.
- **Large lists without virtualization**: `ScrollView` + `.map()` renders all items immediately, causing jank and OOM on large datasets. Always use `FlashList` or `FlatList`.
- **Inline styles**: `style={{ ... }}` creates a new object every render, defeating `React.memo` on child components. Use `StyleSheet.create` or `useMemo`.
- **Missing `keyExtractor`**: Without it, `FlatList`/`FlashList` falls back to index-based keys, causing incorrect recycling and visual glitches on reorder.
- **Animated API on JS thread**: Running animations on the JS thread causes dropped frames. Use `useNativeDriver: true` or Reanimated for 60fps animations.
- **Over-bundling**: Including server-side or web-only libraries in React Native. Check that every dependency supports React Native before adding it.

# Angular Coding Standards (TypeScript-First)

Reference for generating `ai/instructions/frontend.md` in Angular projects.
Assume TypeScript for new code; if the project is JavaScript-only, keep the
same architecture and testing rules and drop the type syntax.

## Component Architecture

- Standalone components are the default. Use `standalone: true` on all new components.
- NgModules only for maintaining legacy code. New features must not introduce new NgModules.
- Prefer the function-based component APIs in new code: `input()`, `output()`,
  and `model()`. Keep `@Input()` / `@Output()` in legacy components unless you
  are already refactoring that file.
- One component per file. Follow Angular naming: `user-card.component.ts`,
  `user-card.component.html`.

```typescript
// DO — standalone component
@Component({
  selector: 'app-user-card',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './user-card.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UserCardComponent {
  user = input.required<User>();
  selected = output<string>();
}

// DON'T — NgModule-dependent component in new code
@NgModule({ declarations: [UserCardComponent], ... })
```

## Signals and State

- Use **signals** for simple synchronous state. They are lighter than RxJS for basic reactivity.
- Use **RxJS** for asynchronous streams, HTTP responses, WebSocket data, and complex event composition.
- Bridge the two intentionally with `toSignal()` / `toObservable()` at the
  boundary. Do not scatter ad-hoc `.subscribe()` calls just to push values into
  local state.

```typescript
// DO — signal for simple state
count = signal(0);
doubleCount = computed(() => this.count() * 2);

increment() { this.count.update(c => c + 1); }

// DO — RxJS for HTTP and streams
users$ = this.http.get<User[]>('/api/users');
searchResults$ = this.searchTerm$.pipe(
  debounceTime(300),
  distinctUntilChanged(),
  switchMap(term => this.userService.search(term))
);

users = toSignal(this.http.get<User[]>('/api/users'), { initialValue: [] });
```

## Dependency Injection

- Services use `providedIn: 'root'` for singletons. Do not add root services to provider arrays.
- Feature-scoped services use `providedIn: 'any'` or provide at the route/component level.
- Use `inject()` function over constructor injection in standalone components.

```typescript
// DO
export class UserListComponent {
  private userService = inject(UserService);
  private router = inject(Router);
}

// DON'T in new standalone components
constructor(private userService: UserService, private router: Router) {}
```

## Templates and Change Detection

- **OnPush on every component.** No exceptions for new code.
- With OnPush, the view updates only on input reference changes, events from the template, async pipe emissions, or signal reads.
- Prefer built-in control flow (`@if`, `@for`, `@switch`) in new templates.
- Use `track` / `trackBy` for list rendering to avoid unnecessary DOM recreation.

```html
<!-- DO -->
@for (user of users; track user.id) {
  <app-user-card [user]="user" />
}

<!-- DON'T — missing track expression -->
@for (user of users) { ... }
```

## Forms

- Use reactive forms (`FormGroup`, `FormControl`) for anything beyond a single input. Template-driven forms are hard to test and type.
- Use typed forms with `NonNullableFormBuilder` or explicit generic form types.
- Validate on blur or submit, not on every keystroke.

## Testing

- Use `TestBed` with standalone component configuration.
- For HTTP tests, use `provideHttpClientTesting()` and `HttpTestingController`.
- Prefer `fixture.nativeElement.querySelector` for DOM assertions, or `@testing-library/angular` for behavior-based tests.
- Prefer `firstValueFrom`, `fakeAsync`, or `TestScheduler` over manual `done`
  callbacks for async tests.

```typescript
// DO
it('should load users on init', () => {
  const req = httpTesting.expectOne('/api/users');
  req.flush(mockUsers);
  fixture.detectChanges();
  expect(fixture.nativeElement.querySelectorAll('.user-card').length).toBe(3);
});
```

## Common Footguns

- **Subscription leaks**: Every `.subscribe()` in a component needs cleanup. Use `takeUntilDestroyed()` or the `async` pipe. Never subscribe in a component without a teardown strategy.
- **Signal/RxJS boundary churn**: Re-wrapping the same stream in multiple places
  creates duplicate subscriptions and inconsistent state. Convert once at the
  boundary and pass the signal or observable down.
- **zone.js performance**: Heavy synchronous work or frequent timers trigger unnecessary change detection cycles. Use `NgZone.runOutsideAngular()` for animation loops and third-party libraries.
- **Circular DI**: Two services injecting each other crashes at runtime. Break the cycle with a mediator service or event bus.
- **`ExpressionChangedAfterItHasBeenCheckedError`**: Changing state in `ngAfterViewInit` that affects the template. Move the state change to `ngOnInit` or wrap in a microtask.
- **Overusing SharedModule**: Stuffing everything into a SharedModule defeats tree-shaking. Import only what each standalone component needs.

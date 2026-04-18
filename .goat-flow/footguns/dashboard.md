---
category: dashboard
last_reviewed: 2026-04-18
---

## Footgun: Alpine.js string `:style` replaces static `style` attribute

**Status:** resolved | **Created:** 2026-04-05 | **Resolved:** 2026-04-18 | **Evidence:** ACTUAL_MEASURED

**Resolution:** Both live violations in `src/dashboard/index.html` converted to object `:style` syntax. Remaining `:style` usages in other view files (for example `src/dashboard/views/projects.html` and `src/dashboard/views/settings.html`) use string syntax but on elements without a static `style=`, so they do not trigger the merge-vs-replace trap.

**Original symptoms:** Inline styles (padding, border-radius, font-size, background color) silently disappear at runtime. Elements render with browser defaults. The source HTML looks correct — the bug is invisible until you inspect the rendered DOM.

**Why it happens:** Alpine.js handles `:style` differently depending on whether you pass a string or an object. A **string** `:style` replaces the entire `style` attribute, wiping any static `style="..."` on the same element. An **object** `:style` merges with the static attribute.

**Original evidence (historical):**
- `src/dashboard/index.html` `<body>` tag paired static `style="background:#1a1a1e;color:#e4e4e7"` with string `:style="darkMode ? '...' : '...'"`. Latent pattern (dynamic string happened to repeat static properties), fixed by converting to object syntax.
- `src/dashboard/index.html` browser directory `<button>` paired static `style="text-align:left;padding:6px 8px;border-radius:4px;..."` with string `:style="dir.isProject ? 'font-weight: 600' : ''"`. Live bug: when `dir.isProject` was falsy, the empty string replaced the full static style, clearing padding, border-radius, cursor, and other declarations. Fixed by converting to `:style="dir.isProject ? { fontWeight: 600 } : {}"`.

**Pattern illustration (kept for future guidance):**
```html
<!-- BUG: static style gets wiped -->
<div style="padding: 20px; background: #4ade80;" :style="`width: ${pct}%`">
<!-- Rendered DOM: style="width: 50%" - padding and background gone -->

<!-- FIX: object syntax merges -->
<div style="padding: 20px; background: #4ade80;" :style="{ width: pct + '%' }">
<!-- Rendered DOM: style="padding: 20px; background: #4ade80; width: 50%" -->
```

**Prevention (retained):**
1. Never combine static `style="..."` with string `:style="..."`. Use object `:style="{ prop: value }"` when a static `style` exists.
2. Alternatively, move all static styles to a CSS class and keep `:style` for dynamic values only.
3. When a UI element looks wrong at runtime but correct in source, check the rendered `style` attribute in devtools — if properties are missing, this is the cause.

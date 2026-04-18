---
category: dashboard
last_reviewed: 2026-04-05
---

## Footgun: Alpine.js string `:style` replaces static `style` attribute

**Status:** active
**Created:** 2026-04-05
**Evidence type:** ACTUAL_MEASURED

**Symptoms:** Inline styles (padding, border-radius, font-size, background color) silently disappear at runtime. Elements render with browser defaults (no padding, no radius, wrong colors). The source HTML looks correct - the bug is invisible until you inspect the rendered DOM.

**Why it happens:** Alpine.js handles `:style` differently depending on whether you pass a string or an object. A **string** `:style` replaces the entire `style` attribute, wiping any static `style="..."` on the same element. An **object** `:style` merges with the static attribute.

**Evidence:**
```html
<!-- BUG: static style gets wiped -->
<div style="padding: 20px; background: #4ade80;" :style="`width: ${pct}%`">
<!-- Rendered DOM: style="width: 50%" - padding and background gone -->

<!-- FIX: object syntax merges -->
<div style="padding: 20px; background: #4ade80;" :style="{ width: pct + '%' }">
<!-- Rendered DOM: style="padding: 20px; background: #4ade80; width: 50%" -->
```

Hit on: scanner tier bars (green fill invisible), agent card buttons (padding/radius gone), grade text (font-size lost), version text (font-size lost).

**Prevention:**
1. Never combine static `style="..."` with string `:style="` ..."`. Use object `:style="{ prop: value }"` when a static `style` exists.
2. Alternatively, move all static styles to a CSS class and keep `:style` for dynamic values only.
3. When a UI element looks wrong at runtime but correct in source, check the rendered `style` attribute in devtools - if properties are missing, this is the cause.

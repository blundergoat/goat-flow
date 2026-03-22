# Milestone 3: HTML Dashboard

**Archetype:** Make It Solid — advanced interface for exploration, multi-agent comparison, and guided prompt generation.

## Objective

Single HTML file that consumes M1's JSON output. Tier drill-down, multi-agent side-by-side comparison, guided prompt wizard with copy-to-clipboard. Works from `file://` and GitHub Pages.

## Design Stack

- **Tailwind CSS v4** via CDN (`<script src="https://cdn.tailwindcss.com">`) — zero build step, single-file compatible
- **Tailwind UI Pro** components — dashboard shell, stats panels, tables, modals, badges (Pro account available)
- **Alpine.js** for reactivity — lightweight, CDN-delivered, no build step
- **No framework** — vanilla JS + Alpine.js directives, everything in one HTML file
- All dependencies loaded from CDN with `integrity` hashes for `file://` offline use

### Design Language

| Element | Tailwind Pattern |
|---------|-----------------|
| Layout | Application shell with sidebar nav (Tailwind UI "Stacked Layout") |
| Grade display | Large stat card with ring/donut chart (Tailwind UI "Stats") |
| Tier breakdown | Stacked progress bars with percentage labels |
| Check list | Expandable disclosure panels (Tailwind UI "Description Lists") |
| Agent tabs | Horizontal tabs with badge counts (Tailwind UI "Tabs") |
| Status badges | `pass` = green, `partial` = amber, `fail` = red, `na` = gray (Tailwind UI "Badges") |
| Recommendations | Priority-sorted card list with severity stripe (critical=red, high=orange, medium=yellow, low=blue) |
| Prompt wizard | Multi-step modal with code preview + copy button (Tailwind UI "Modal Dialogs") |
| Dark mode | `class` strategy — toggle via button, persist to localStorage |

### Color Mapping

```
Grade A  → emerald-500    Grade D  → orange-500
Grade B  → blue-500       Grade F  → red-500
Grade C  → amber-500      N/A      → slate-400
```

## Tasks

### Phase A: Shell + Data Loading (1 session)
1. [ ] HTML skeleton with Tailwind CDN + Alpine.js CDN
2. [ ] JSON input: paste textarea OR file picker OR URL param (`?data=`)
3. [ ] Parse and validate ScanReport schema (schemaVersion check)
4. [ ] Alpine.js store: `report`, `selectedAgent`, `expandedChecks`, `darkMode`
5. [ ] Application shell: sidebar with agent list, main content area

### Phase B: Score Overview (1 session)
6. [ ] Grade card — large letter grade with percentage ring (SVG donut)
7. [ ] Tier progress bars — foundation / standard / full with earned/available
8. [ ] Anti-pattern deduction summary — triggered count, total deduction
9. [ ] Agent tab switcher — one tab per detected agent, badge with grade
10. [ ] Meta info bar — rubric version, check count, timestamp

### Phase C: Check Detail Drill-Down (1-2 sessions)
11. [ ] Check list grouped by tier → category, sorted by status (fail → partial → pass → na)
12. [ ] Expandable check row: status badge, points, confidence, evidence
13. [ ] Evidence display with monospace formatting (file paths, grep matches)
14. [ ] Filter controls: tier filter, status filter, search by check name/id
15. [ ] "Show only failures" quick toggle

### Phase D: Multi-Agent Comparison (1 session)
16. [ ] Side-by-side grade comparison table (all agents in columns)
17. [ ] Per-tier comparison row with delta indicators (↑ / ↓ / =)
18. [ ] Check-level diff: highlight where agents diverge on the same check
19. [ ] Heatmap view: checks × agents grid, color-coded by status

### Phase E: Prompt Wizard (1-2 sessions)
20. [ ] Recommendation list with checkboxes (pre-select all failed)
21. [ ] Agent selector for prompt target
22. [ ] Prompt preview pane with syntax highlighting
23. [ ] Copy-to-clipboard button with success toast
24. [ ] "Select all critical" / "Select all for tier" shortcuts

### Phase F: Polish (1 session)
25. [ ] Dark mode toggle (persisted to localStorage)
26. [ ] Responsive layout (mobile: stacked, desktop: sidebar)
27. [ ] Keyboard navigation (arrow keys in check list, Escape to close modals)
28. [ ] Print-friendly `@media print` styles
29. [ ] Loading state and error handling (invalid JSON, wrong schema version)
30. [ ] Accessibility: ARIA labels, focus management, screen reader announcements

## Exit Criteria

- [ ] Dashboard renders correctly from M1 JSON
- [ ] Drill-down shows evidence per check
- [ ] Prompt wizard generates correct prompts
- [ ] Copy-to-clipboard works in Chrome, Firefox, Safari
- [ ] `file://` works fully offline (after initial CDN cache)
- [ ] Dark mode toggles cleanly without FOUC
- [ ] Multi-agent comparison shows meaningful deltas
- [ ] All Tailwind UI components render without build step

## Human Testing Gate

- [ ] Open the HTML file from `file://` — confirm it loads and renders
- [ ] Paste scan JSON from a multi-agent project — confirm side-by-side comparison works
- [ ] Click through drill-down on 3+ checks — confirm evidence is shown
- [ ] Generate a prompt via the wizard — copy to clipboard, paste into an agent, confirm it works
- [ ] Toggle dark mode — confirm no visual glitches
- [ ] Test on mobile viewport — confirm responsive layout works
- [ ] Test with keyboard only — confirm all interactions are accessible

M3 is NOT complete until the user has tested the dashboard in a real browser.

## Key Decisions

| Decision | Why |
|----------|-----|
| Tailwind CSS v4 CDN, not build step | Single-file HTML constraint. CDN v4 supports `@apply` and custom config inline. |
| Tailwind UI Pro components | Pro account available. Proven patterns, saves design time. Dashboard, stats, tables all exist. |
| Alpine.js, not React/Vue | Zero build step. ~15KB. Declarative enough for this UI. Keeps everything in one file. |
| SVG donut for grade, not canvas | SVG is print-friendly, accessible, and doesn't need a library. |
| Dark mode via class strategy | Works with Tailwind's `dark:` variants. localStorage persistence is trivial. |
| `?data=` URL param | Allows linking directly to a pre-loaded dashboard (base64 or URL to JSON). |

*Re-plan after M2 ships. The prompt wizard depends on M2's fragment system.*

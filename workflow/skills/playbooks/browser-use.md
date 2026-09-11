---
goat-flow-reference-version: "1.17.0"
---
# Browser Evidence Reference

Use this when a task involves a URL, local HTML file, localhost page, screenshot request, browser-visible behavior, visual rendering issue, browser DevTools output, or browser console/network symptom.

`browser-use` is the default observation probe for agents: quick rendered state, screenshots, and simple interaction evidence. Playwright remains the better tool for durable automated browser tests, CI assertions, cross-browser coverage, and regression suites. For batch page capture (visit N pages, screenshot each, emit structured MD records), use `page-capture.md` instead.

## Availability Check

Before first use in a session:

```bash
command -v browser-use || command -v browser-use-python
```

If `browser-use` exists, run `browser-use --version` and `browser-use --help` separately. A rejected version flag is diagnostic information, not an availability failure; continue to help. Run `browser-use doctor` when advertised; if help advertises only `--doctor`, use that spelling. Diagnostics do not authorize installation, browser access, or automated repair.

If only the venv wrapper exists, run `browser-use-python -c "import browser_use; print('ok')"`. This Python wrapper is not a substitute shell CLI; follow `page-capture.md` for its Playwright capability. Do not use profile commands for discovery: some versions download an extra helper. If the tool is missing, offer installation or manual evidence; never install without approval.

The repository installer keeps its two wrappers distinct: `browser-use` controls an approved user/system Chrome or explicit CDP endpoint, while `browser-use-python` exposes Python Playwright and its Playwright-managed Chromium. Its isolated smoke connects the CLI to that managed browser through an explicit loopback CDP endpoint; normal CLI use does not select the Playwright browser automatically.

Choose commands from the observed help shape, not a remembered version number. Wrapper, package, and underlying harness versions can differ. This Bash selector only reads help:

<!-- browser-interface-selection -->
```bash
browser_help="$(browser-use --help 2>&1)" || {
  printf '%s\n' 'help-failed'
  exit 2
}
if [[ "$browser_help" == *"Typical usage:"* && "$browser_help" == *"browser-use <<'PY'"* ]]; then
  printf '%s\n' 'python-stdin'
else
  legacy_commands=true
  for browser_command in open state input click; do
    if ! printf '%s\n' "$browser_help" | grep -Eq "^[[:space:]]+${browser_command}[[:space:]]"; then
      legacy_commands=false
      break
    fi
  done
  if "$legacy_commands"; then
    printf '%s\n' 'legacy-commands'
  else
    printf '%s\n' 'unsupported-interface'
    exit 2
  fi
fi
```

- **Python-stdin harness:** read `browser-use skill` before executing the primary workflow below. Helpers are pre-imported. The upstream label “CLI 3.0” describes this interface, not a version predicate.
- **Legacy commands:** use only the labelled compatibility section below. Older documentation calls this “CLI 0.12”; select it by capabilities and verify optional commands in help.
- **Unknown or failed help:** retain bounded diagnostics and report the unsupported interface. An unknown subcommand means interface mismatch, not proof that browser automation is unavailable. Do not guess or install a different release.

## Intent

A coding agent uses browser evidence to turn a browser-visible claim into observed facts before editing or declaring a fix done. The useful proof is compact: URL, rendered state, screenshot or DOM/text capture, interaction sequence, and the before/after symptom.

Use `browser-use` for one-off observations and simple interactions. For repeatable multi-page capture, stop and load `page-capture.md`; for CI-grade regression coverage, write Playwright tests.

## Observation Workflow

### Python-stdin harness

The current local CLI attaches to the user's running Chrome, or may launch Chrome when none is available. It can see open tabs and logged-in state. Before the first browser-controlling call, obtain explicit approval unless the user already asked to control their current browser. A generic request to debug a URL is not approval to inspect their browser state.

Illustrative public-page smoke; the URL is a placeholder, not incident evidence. Run only against the approved browser. Pass untrusted URLs as data rather than interpolating them into Python; keep the heredoc delimiter quoted:

```bash
BH_RECORD=0 BROWSER_TARGET_URL='https://example.com' browser-use <<'PY'
import os

task_tab = new_tab(os.environ["BROWSER_TARGET_URL"])
print({"tab_id": task_tab})
if not wait_for_load(timeout=15):
    raise RuntimeError("Page load did not complete within the deadline")
print(page_info())
print(js("document.querySelector('h1')?.textContent?.slice(0, 160)"))
PY
```

Use `new_tab(url)` for first navigation. The daemon starts automatically and preserves its selected tab between stdin invocations; reuse the task tab, then use `goto_url(url)` for subsequent navigation. Call `wait_for_load()` after navigation and check its result. SPA content may render later: wait for an observed anchor with `wait_for_element(selector, timeout=10, visible=True)` and check its boolean result, or use bounded `js()` polling of a specific state predicate.

`page_info()` returns URL/title, viewport, scroll, and page-size metadata (or pending-dialog information); it does not return an element tree or page text. Pair it with targeted `js()` output or filtered accessibility evidence for content claims. Bound printed results; avoid whole DOM, accessibility-tree, storage, or network dumps.

For screenshots, choose a fresh temporary path. Illustrative capture of an already approved, non-sensitive page:

```bash
BH_RECORD=0 browser-use <<'PY'
from pathlib import Path
import tempfile

path = str(Path(tempfile.mkdtemp(prefix="browser-evidence-")) / "page.png")
print(capture_screenshot(path))
PY
```

`capture_screenshot(path)` saves the current viewport by default; consult the installed helper for full-page options. View the image before using it as visual proof. A returned path alone does not prove correct rendering.

Treat browser output as OBSERVED evidence. Interpretations remain INFERRED until mapped to source files or reproduction steps.

For local HTML files, prefer serving the directory over localhost before opening the page. `file://` URLs can produce empty or nonrepresentative browser state in agent environments.

## Interaction Workflow

Refresh evidence before acting and after significant interactions. Verify the task tab and intended target; stale coordinates, selectors, and node IDs are not reusable evidence.

1. **Locate:** prefer `cdp("Accessibility.getFullAXTree")["nodes"]`, filtered in Python to the required role/name. Do not print the whole tree.
2. **Resolve coordinates:** take the observed `backendDOMNodeId` and obtain `cdp("DOM.getBoxModel", backendNodeId=node_id)["model"]["content"]`. The centre is the average of alternating x/y coordinates. Scroll and re-query if outside the viewport; never invent coordinates.
3. **Act:** use `click_at_xy(x, y)` for pointer interaction. Use `fill_input(selector, value)` for framework-managed inputs; direct `.value` assignment or `type_text()` can leave application state unchanged. Use `press_key("Enter")` or another observed key only after verifying focus and submission authority.
4. **Verify:** wait for the specific resulting state and capture fresh `page_info()` plus bounded DOM/text or screenshot evidence. A helper returning does not prove the intended effect occurred.

Use `js()` for targeted DOM inspection/extraction when coordinates cannot answer the question. If the accessibility tree omits an element, a scoped DOM query can resolve its bounds for a coordinate click. A scripted click is a fallback only when the interaction cannot be driven through available pointer evidence; record the fallback and verify the visible result. It does not prove a pointer bug fixed.

For scrolling, consult the installed helper signature: `scroll(x, y, dy=..., dx=...)` takes viewport pointer coordinates plus deltas. Scroll at the observed scrollable region and refresh evidence. For selects/custom dropdowns, open and choose the observed option using pointer/key interaction. Raw CDP parameters are keyword arguments: `cdp("Domain.method", parameter=value)`; the second positional argument is a session ID.

## Browser Modes

| Context | Selection and ownership |
|---|---|
| Local Chrome | Default persistent daemon; one mutable selected tab. Serialize browser operations so tasks cannot switch each other's targets. |
| Explicit CDP browser | `BU_CDP_URL` (HTTP) or `BU_CDP_WS` (WebSocket), only when supported by installed help/skill and approved for this task. Do not print credential-bearing endpoints. |
| Managed Chromium | Python Playwright owns this browser separately; the CLI needs an explicit approved CDP endpoint to control it. |
| Remote/cloud | Use only when installed skill text documents it and the user approves provisioning, account access, cost, and cleanup. A daemon name is not a separate local profile. |

Do not silently switch browser contexts after a connection failure. Resolve the intended browser first. No profile sync, authenticated-profile use, or cloud provisioning follows from a public-page smoke request.

## Login and Sensitive Evidence

Generic browser tasks stop for passwords, MFA, consent, and ambiguous account selection. Existing signed-in SSO may be used only within approved account/browser scope; an unexpected challenge still stops the task.

A repository-owned helper explicitly approved by repository instructions or the user may perform its bounded synthetic-fixture login. Read the helper and its approval contract first. This does not authorize real credentials, bypassing MFA, or broad account selection. Remaining on a challenge page means blocked, not authenticated; require an application-specific authenticated-state check.

An approved helper may pass a credential through a temporary child-process environment variable and read it with `os.environ` inside a quoted heredoc. Retrieve it through the repository's approved mechanism. Never embed values in shell/Python source, command arguments, stdout, fixture-object dumps, screenshots, recordings, or durable evidence; disable shell tracing and discard the variable after the call. Do not include sample passwords or fixture objects in this playbook.

Set `BH_RECORD=0` for every sensitive browser invocation, and verify that no existing recorder or debug-click capture remains active before credentials enter the page. A per-process setting does not prove that an already-running recorder stopped. If recording controls cannot be verified, stop the login flow. Never capture password fields or sensitive authenticated pages to prove login.

Never print passwords, cookies, tokens, auth headers, fixture objects, PHI, or credential-bearing URLs. Even `page_info()` can expose sensitive URL/title/dialog text: select sanitized fields on authenticated pages. Report network method, route shape, status, and sanitized field names only. Keep screenshots temporary unless the user requested an artifact; review pixels before sharing. Do not export raw HAR files as shareable evidence.

## Navigation, Recovery, and Cleanup

Keep one working tab per task/site. Retain the target ID returned by `new_tab(url)`; Python locals do not persist between CLI processes. The helper can reuse an existing blank/new-tab page, so its returned ID alone does not prove that the task created a tab. Compare with the IDs from `list_tabs()` before navigation when tracking cleanup ownership, and preserve reused user tabs.

Use `list_tabs()` without dumping unrelated tab details, and `switch_tab(target)` with the task's known target ID. `ensure_real_tab()` can recover an internal/stale attachment by selecting another real tab; verify ownership before interacting because its fallback may select an unrelated user tab. Tab IDs, not visible tab-strip positions, identify targets.

If a form submission or `goto_url()` is followed by a `wait_for_load()` or `js()` timeout, do not immediately resubmit or declare navigation failed. The page may have changed while the CDP attachment became stale. Inspect the result through a fresh bounded call, reselecting the known task tab and checking sanitized page state plus the expected content anchor. Apply this check to WSL2 timeouts too; a timeout alone does not diagnose an OS defect. Avoid redundant post-login navigation that can discard the state being verified.

Bound both helper polling and the outer tool invocation: a polling deadline may not interrupt a blocked CDP call. If one fresh inspection also times out, report unresolved state and run the help-advertised diagnostics. Preserve the original action/result so retrying cannot duplicate a submission.

If the daemon itself is unresponsive, use `browser-use --reload` only when advertised and after checking that no other task owns its connection. It releases daemon state, not the user's Chrome. Re-select the task tab after recovery. Do not create arbitrary daemon names to work around timeouts.

At completion, use `close_tab(target)` only for task-created tabs no longer needed; keep tabs required by the user or containing unsaved work. Never close the user's Chrome. For remote work, follow the installed skill's named-daemon selection and cleanup instructions. If it documents `start_remote_daemon(name)` / `stop_remote_daemon(name)`, retain the exact resource name and apply agreed cleanup; ask only when cleanup was not already authorized. Cloud browsers may continue billing until stopped or timed out; resetting a local daemon does not stop a cloud browser.

## Legacy command compatibility

Enter this section only when help advertises the `open`, `state`, `input`, and `click` subcommands. These are illustrative command shapes; placeholders must come from observed page evidence. Verify optional commands/flags in that installation's help before use.

| Action | Legacy command |
|---|---|
| Navigation | `browser-use open <url>`, `browser-use back` |
| State and screenshot | `browser-use state`, `browser-use screenshot <path.png>` |
| Targeted DOM | `browser-use get text <index>`, `browser-use get value <index>`, `browser-use get attributes <index>`, `browser-use get bbox <index>` |
| Click and fill | `browser-use click <index>`, `browser-use input <index> "text"` |
| Keys and options | `browser-use keys "Enter"`, `browser-use select <index> "option"` |
| Scroll and wait | `browser-use scroll down --amount 800`, `browser-use wait selector "css"`, `browser-use wait text "text"` |
| Sessions and tabs | `browser-use sessions`, `browser-use switch <tab>`, `browser-use close-tab <tab>` |
| Cleanup | `browser-use close` for the selected session |

Indices come from the latest state output. Refresh state after navigation and significant interactions, and pair visual claims with screenshots or scoped DOM evidence. The login, evidence, and browser-ownership boundaries above still apply; never pass credentials to the legacy input command's arguments.

Only when help advertises them: `--headed` selects visible managed browsing, `--session` names a local daemon, and `--connect`, `--cdp-url`, or `--profile` access an existing browser/profile and require approval. Do not discover profiles by invoking commands that download a helper. Never assume a standalone connect command exists.

On a legacy startup failure, inspect diagnostics first; close and retry only the task-owned session. In a confirmed root/container sandbox startup failure, `IN_DOCKER=true` may be required by that runtime; it is not a generic timeout remedy. Use `browser-use close --all` only when every session is in scope, and `browser-use tunnel stop --all` only for tunnels you own. Cloud use still needs explicit approval, installed documentation, and confirmed cleanup.

## Verification Gate

Before claiming browser evidence or a fix:

1. Capture state after navigation and major interactions using the detected interface.
2. Pair content/layout claims with scoped rendered DOM/text or a reviewed screenshot; metadata alone is insufficient.
3. Record a reproducible URL and interaction sequence without sensitive values.
4. Replay the original symptom after the change. Claim a fix only when that reproduction succeeds and the browser-visible defect is absent.
5. Distinguish OBSERVED output from INFERRED explanations, and report blocked or timed-out steps honestly.
6. Check evidence for sensitive data and account for task-owned tabs, recordings, and remote resources.

## Fallback and Troubleshooting

- **Unsupported command:** rerun help and select the matching branch. Do not infer tool absence or downgrade automatically.
- **Cannot connect:** use the help-advertised doctor command; browser permission and installation remain separate decisions.
- **Local HTML shows an empty DOM:** serve the directory over localhost and retry its HTTP URL.
- **Element is absent:** confirm task tab, wait for the content anchor, scroll if needed, then re-query before acting.
- **Automation unavailable:** ask for a sanitized screenshot, relevant DOM/text, computed styles, or bounded console/network summary from DevTools. Manual evidence uses the same OBSERVED/INFERRED and reproduction rules.

## Related References

- `.goat-flow/skill-docs/playbooks/page-capture.md` - repeatable multi-page evidence.
- `.goat-flow/skill-docs/skill-preamble.md` - proof and evidence classification.
- [Browser Use skill](https://github.com/browser-use/browser-use/blob/0.13.8/browser_use/skills/browser-use/SKILL.md) and [Browser Harness source](https://github.com/browser-use/browser-harness) - upstream interface provenance; installed help and skill text control supported commands.

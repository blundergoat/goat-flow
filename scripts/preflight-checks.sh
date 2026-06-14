#!/usr/bin/env bash
# shellcheck disable=SC2317
# Many helpers (render_report and friends) are reached only via the EXIT
# trap below, which shellcheck's reachability analysis doesn't follow.
# Disable the warning file-wide rather than tagging every function.

# preflight-checks.sh
#
# Purpose:
#   Runs the local pre-flight quality gate used before risky edits or releases.
#
# Usage:
#   bash scripts/preflight-checks.sh
#
# Behavior:
#   - runs project quality gates
#   - runs shell and CLI syntax checks
#   - checks formatting and project-specific quality signals
#
# Exit:
#   0 when all checks pass, non-zero on any failing check.
#
# Requirements:
#   - bash, node, npm, git

set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT_DIR" || exit 1
MANIFEST_PATH="$ROOT_DIR/workflow/manifest.json"

# ── Output mode flags ────────────────────────────────────────────────
# Parsed before anything else so capability detection can use them.
verbose=0
no_color=
ascii_mode=
for arg in "$@"; do
    case "$arg" in
        -v|--verbose) verbose=1 ;;
        --no-color)   no_color=1 ;;
        --ascii)      ascii_mode=1 ;;
        -h|--help)
            cat <<'HELP'
Usage: preflight-checks.sh [--verbose] [--no-color] [--ascii] [--help]

Runs the local pre-flight quality gate. Exits 0 when all checks pass,
non-zero otherwise.

Options:
  -v, --verbose    Expand every sub-check (default collapses to one row per
                   section; failing/warning sections always expand).
      --no-color   Disable ANSI colour. Equivalent to NO_COLOR=1.
      --ascii      Force ASCII fallback for terminals without box-drawing.
                   Auto-enabled when LANG/LC_ALL is missing UTF-8.
  -h, --help       Show this help and exit.

Environment:
  NO_COLOR=1     - same as --no-color
  FORCE_COLOR=1  - force colour even when stdout is not a TTY
  COLUMNS=N      - override terminal width detection (default: tput cols, or 80)
  CI=true        - implies --no-color unless FORCE_COLOR is set
  GOAT_FLOW_PREFLIGHT_TEST_TIMEOUT_SECONDS=N
                 - test command timeout in seconds (default: 600; 0 disables)
HELP
            exit 0
            ;;
        *)
            echo "preflight-checks.sh: unknown option: $arg" >&2
            echo "Run with --help for usage." >&2
            exit 2
            ;;
    esac
done

manifest_eval() {
    node - "$MANIFEST_PATH" "$@" <<'NODE'
const fs = require("node:fs");

const manifestPath = process.argv[2];
const mode = process.argv[3];
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

if (mode === "skill-roots") {
  const roots = [
    ...new Set(
      Object.values(manifest.agents || {})
        .map((agent) =>
          typeof agent.skills_dir === "string"
            ? agent.skills_dir.replace(/\/$/, "")
            : "",
        )
        .filter(Boolean),
    ),
  ];
  for (const root of roots) console.log(root);
  process.exit(0);
}

if (mode === "hook-dirs") {
  const dirs = [
    ...new Set(
      Object.values(manifest.agents || {})
        .map((agent) =>
          typeof agent.hooks_dir === "string"
            ? agent.hooks_dir.replace(/\/$/, "")
            : "",
        )
        .filter(Boolean),
    ),
  ];
  for (const dir of dirs) console.log(dir);
  process.exit(0);
}

if (mode === "supported-skills") {
  for (const skill of manifest.skills?.canonical || []) console.log(skill);
  process.exit(0);
}

if (mode === "skill-files") {
  const skillName = process.argv[4];
  const canonical = manifest.skills?.canonical;
  const references = manifest.skills?.references || {};
  if (!Array.isArray(canonical) || !canonical.includes(skillName)) {
    process.stderr.write(`unknown skill: ${skillName}\n`);
    process.exit(2);
  }
  const referenceFiles = Array.isArray(references[skillName])
    ? references[skillName].filter((value) => typeof value === "string")
    : [];
  const files = [
    "SKILL.md",
    ...referenceFiles,
  ];
  for (const file of files) console.log(file);
  process.exit(0);
}

process.stderr.write(`unknown manifest_eval mode: ${mode}\n`);
process.exit(1);
NODE
}

# ── Output formatter (M-preflight-redesign) ──────────────────────────
# Buffer-then-render: helpers append rows to a TSV ledger; render_report
# walks the ledger at the end and emits a phased summary. Default output
# collapses each section to one row; --verbose or any FAIL/WARN expands
# the section under an indent guide. Adding a new check needs three
# things: (1) call section "Display Name" before the sub-checks run;
# (2) call pass/fail/warn/skip from inside each sub-check; (3) add an
# entry to phase_for / display_for / collapsed_desc_for so the section
# lands under the right phase heading with a meaningful summary line.

# ── Capability detection ─────────────────────────────────────────────
_is_tty=0
[[ -t 1 ]] && _is_tty=1

_use_color=1
if [[ -n "$no_color" ]] || [[ -n "${NO_COLOR:-}" ]]; then
    _use_color=0
elif [[ "${CI:-}" == "true" ]] && [[ -z "${FORCE_COLOR:-}" ]]; then
    _use_color=0
elif [[ "$_is_tty" -eq 0 ]] && [[ -z "${FORCE_COLOR:-}" ]]; then
    _use_color=0
fi
if [[ "$_use_color" -eq 1 ]] && command -v tput >/dev/null 2>&1; then
    _color_count=$(tput colors 2>/dev/null || echo 0)
    [[ "$_color_count" -lt 8 ]] && _use_color=0
fi

if [[ "$_use_color" -eq 1 ]]; then
    R=$'\033[0;31m'; G=$'\033[0;32m'; Y=$'\033[0;33m'; CY=$'\033[0;36m'
    DIM=$'\033[2m'; BOLD=$'\033[1m'; RST=$'\033[0m'
else
    R=''; G=''; Y=''; CY=''; DIM=''; BOLD=''; RST=''
fi

_use_ascii=0
if [[ -n "$ascii_mode" ]]; then
    _use_ascii=1
elif [[ "${LANG:-}${LC_ALL:-}" != *UTF-8* ]] && [[ "${LANG:-}${LC_ALL:-}" != *utf8* ]]; then
    _use_ascii=1
fi

if [[ "$_use_ascii" -eq 1 ]]; then
    GLYPH_PASS='+'; GLYPH_FAIL='x'; GLYPH_WARN='!'; GLYPH_SKIP='-'
    RULE_TOP='='; RULE_MID='-'; GUIDE='|'
else
    GLYPH_PASS='✓'; GLYPH_FAIL='✗'; GLYPH_WARN='⚠'; GLYPH_SKIP='⊘'
    RULE_TOP='━'; RULE_MID='─'; GUIDE='│'
fi


# Terminal width (overridden by COLUMNS, then tput cols, then 80).
_term_cols=${COLUMNS:-}
if [[ -z "$_term_cols" ]]; then
    if [[ "$_is_tty" -eq 1 ]] && command -v tput >/dev/null 2>&1; then
        _term_cols=$(tput cols 2>/dev/null || echo 80)
    else
        _term_cols=80
    fi
fi
[[ "$_term_cols" -lt 40 ]] && _term_cols=40

# ── Ledger setup ─────────────────────────────────────────────────────
LEDGER_DIR=$(mktemp -d -t preflight.XXXXXX)
LEDGER="$LEDGER_DIR/ledger.tsv"
: > "$LEDGER"

# render_report runs from the EXIT trap so the report still prints when
# set -e + pipefail kills the script mid-check (e.g. a failure-detail
# pipeline tripping pipefail). Cleanup follows render. We override the
# exit code to FAIL when errors were recorded, since set -e may exit
# the script before the explicit exit statement runs.
_render_done=0
_on_exit() {
    # NB: variable name avoids `rc` because bash uses dynamic scoping
    # for locals; sub-functions like _emit_section_row's `read -r ...`
    # would otherwise clobber it on every row and `exit "$rc"` ends up
    # as `exit ""`.
    local _exit_rc=$?
    [[ "$_exit_rc" =~ ^[0-9]+$ ]] || _exit_rc=0
    if [[ "$_render_done" -eq 0 ]]; then
        _render_done=1
        # Render anything left over: the just-finished section's row
        # (if not yet emitted) and the footer. Wrap in `|| true` so a
        # render error doesn't mask the script's real exit code.
        {
            _emit_header_once
            _record_section_elapsed
            if [[ -n "$current_section" ]]; then
                _emit_section_row "$current_section"
                current_section=""
            fi
            _emit_footer
        } 2>&1 || true
    fi
    rm -rf "$LEDGER_DIR" 2>/dev/null || true
    if [[ "${errors:-0}" -gt 0 ]] && [[ "$_exit_rc" -eq 0 ]]; then
        _exit_rc=1
    fi
    exit "$_exit_rc"
}
trap '_on_exit' EXIT

errors=0
warnings=0
checks=0

# Millisecond-precision timing with portable fallback (macOS date lacks %N).
if date +%s%N 2>/dev/null | grep -qv N; then
    now_ms() { echo $(( $(date +%s%N) / 1000000 )); }
elif command -v node >/dev/null 2>&1; then
    now_ms() { node -e 'process.stdout.write(String(Date.now()))'; }
else
    now_ms() { echo $(( $(date +%s) * 1000 )); }
fi
fmt_elapsed() {
    # one-decimal seconds, e.g. 5.1s, 0.0s
    local ms=$(( $1 ))
    local secs=$(( ms / 1000 ))
    local frac=$(( (ms % 1000) / 100 ))
    printf '%d.%ds' "$secs" "$frac"
}

preflight_start=$(now_ms)
section_start=$(now_ms)
current_section=""

# ── Helpers ──────────────────────────────────────────────────────────
_record_section_elapsed() {
    if [[ -n "$current_section" ]]; then
        local now elapsed
        now=$(now_ms)
        elapsed=$(( now - section_start ))
        printf 'ELAPSED\t%s\t%d\n' "$current_section" "$elapsed" >> "$LEDGER"
    fi
    return 0
}

section() {
    _record_section_elapsed
    _emit_header_once
    if [[ -n "$current_section" ]]; then
        _emit_section_row "$current_section"
    fi
    current_section="$1"
    section_start=$(now_ms)
    printf 'SECTION\t%s\n' "$current_section" >> "$LEDGER"
    local phase
    phase=$(phase_for "$1")
    _emit_phase_if_changed "$phase"
    return 0
}

# Sub-check helpers append one ROW per call; counters increment for the
# verdict tally exactly as before. Embedded newlines in the message are
# collapsed to ` | ` so the TSV ledger stays one row per call (some
# checks compose messages from grep -c output that can include a stray
# trailing newline).
_one_line() { printf '%s' "${1//$'\n'/ | }"; }
pass()  { checks=$((checks + 1)); printf 'ROW\tPASS\t%s\t%s\n' "$current_section" "$(_one_line "$1")" >> "$LEDGER"; }
fail()  { checks=$((checks + 1)); errors=$((errors + 1)); printf 'ROW\tFAIL\t%s\t%s\n' "$current_section" "$(_one_line "$1")" >> "$LEDGER"; }
warn()  { checks=$((checks + 1)); warnings=$((warnings + 1)); printf 'ROW\tWARN\t%s\t%s\n' "$current_section" "$(_one_line "$1")" >> "$LEDGER"; }
skip()  { printf 'ROW\tSKIP\t%s\t%s\n' "$current_section" "$(_one_line "$1")" >> "$LEDGER"; }
note()  { warnings=$((warnings + 1)); printf 'ROW\tWARN\t%s\t%s\n' "$current_section" "$(_one_line "$1")" >> "$LEDGER"; }

# Detail lines belong to the current section. They render under the
# failure expansion (verbose mode, or any failed/warned section). Pipe
# any multi-line output through details_pipe to attach it to the row.
details_pipe() {
    while IFS= read -r line; do
        printf 'DETAIL\t%s\t%s\n' "$current_section" "$line" >> "$LEDGER"
    done
}

run_command_capture_with_timeout() {
    local __output_var="$1"
    local __status_var="$2"
    local timeout_seconds="$3"
    shift 3
    local output status

    output="$(
        node - "$timeout_seconds" "$@" <<'NODE' 2>&1
const { spawn } = require("node:child_process");

const timeoutSeconds = Number(process.argv[2] || "0");
const command = process.argv[3];
const args = process.argv.slice(4);
let timedOut = false;
let forceKillTimer = null;
const chunks = [];
const child = spawn(command, args, {
  detached: process.platform !== "win32",
  stdio: ["ignore", "pipe", "pipe"],
});

function killChild(signal) {
  if (!child.pid) return;
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch {
    // The child may already have exited between the timeout and signal.
  }
}

child.stdout.on("data", (chunk) => chunks.push(chunk));
child.stderr.on("data", (chunk) => chunks.push(chunk));
child.on("error", (error) => {
  chunks.push(Buffer.from(String(error.message || error)));
});

const timer =
  Number.isFinite(timeoutSeconds) && timeoutSeconds > 0
    ? setTimeout(() => {
        timedOut = true;
        killChild("SIGTERM");
        forceKillTimer = setTimeout(() => killChild("SIGKILL"), 1000);
        forceKillTimer.unref();
      }, timeoutSeconds * 1000)
    : null;

child.on("close", (code) => {
  if (timer) clearTimeout(timer);
  if (forceKillTimer) clearTimeout(forceKillTimer);
  const outputChunks = [Buffer.concat(chunks)];
  if (timedOut) {
    outputChunks.push(
      Buffer.from(`\n[preflight] command timed out after ${timeoutSeconds}s: ${[
        command,
        ...args,
      ].join(" ")}\n`),
    );
  }
  process.stdout.write(Buffer.concat(outputChunks), () => {
    process.exit(timedOut ? 124 : code === null ? 1 : code);
  });
});
NODE
    )" && status=0 || status=$?

    printf -v "$__output_var" '%s' "$output"
    printf -v "$__status_var" '%s' "$status"
}

# ── Phase mapping (centralised) ──────────────────────────────────────
# In live rendering, the phase heading prints whenever the phase
# changes between two consecutive sections. There's no precomputed
# phase order - sections appear in execution order, and a phase's
# heading may repeat if its sections aren't contiguous.
phase_for() {
    case "$1" in
        "Shell Scripts"|"TypeScript") printf 'STATIC' ;;
        "Deny Policy"|"ADR Enforcement"|"Gruff Policy") printf 'POLICY' ;;
        "Agent Config Parity"|"Skill and Reference Versions"|"Version Consistency") printf 'CONFIG INTEGRITY' ;;
        "Skill Behavioral Contracts"|"Reference Budgets"|"Cross-Agent Consistency"|"Instruction Parity Contract"|"Instruction File Quality") printf 'CONTRACTS' ;;
        "Tests"|"Dependency Audit") printf 'TESTS' ;;
        "GOAT Flow Audit"|"Learning-Loop Schema"|"Doc/Code Drift"|"Content Drift"|"Skill Docs Sync"|"Skill SKILL.md Parity") printf 'DRIFT' ;;
        "Path Integrity"|"Markdown Links"|"Package README Links") printf 'LINKS' ;;
        *) printf 'OTHER' ;;
    esac
}

display_for() {
    case "$1" in
        "Shell Scripts") printf 'Shell scripts' ;;
        "TypeScript") printf 'TypeScript' ;;
        "Deny Policy") printf 'Deny policy' ;;
        "ADR Enforcement") printf 'ADR enforcement' ;;
        "Gruff Policy") printf 'Gruff policy' ;;
        "Agent Config Parity") printf 'Agent config parity' ;;
        "Skill and Reference Versions") printf 'Skill versions' ;;
        "Version Consistency") printf 'Version consistency' ;;
        "Skill Behavioral Contracts") printf 'Skill behavioural' ;;
        "Reference Budgets") printf 'Reference budgets' ;;
        "Cross-Agent Consistency") printf 'Cross-agent' ;;
        "Instruction Parity Contract") printf 'Instruction parity' ;;
        "Instruction File Quality") printf 'Instruction quality' ;;
        "Tests") printf 'Test suite' ;;
        "Dependency Audit") printf 'Dependency audit' ;;
        "GOAT Flow Audit") printf 'GOAT flow audit' ;;
        "Learning-Loop Schema") printf 'Learning-loop schema' ;;
        "Content Drift") printf 'Content drift' ;;
        "Doc/Code Drift") printf 'Doc/code drift' ;;
        "Skill Docs Sync") printf 'Skill docs sync' ;;
        "Skill SKILL.md Parity") printf 'Skill SKILL.md parity' ;;
        "Path Integrity") printf 'Path integrity' ;;
        "Markdown Links") printf 'Markdown links' ;;
        "Package README Links") printf 'Package README' ;;
        *) printf '%s' "$1" ;;
    esac
}

collapsed_desc_for() {
    case "$1" in
        "Shell Scripts") printf 'bash syntax + shellcheck' ;;
        "TypeScript") printf 'build · lint · knip · prettier' ;;
        "Deny Policy") printf 'self-test + runtime smokes' ;;
        "ADR Enforcement") printf 'no removed patterns' ;;
        "Gruff Policy") printf 'no enabled:false in .gruff-ts.yaml' ;;
        "Agent Config Parity") printf 'claude · codex · antigravity · copilot' ;;
        "Skill and Reference Versions") printf 'templates + installed match version' ;;
        "Version Consistency") printf 'package.json · config.yaml' ;;
        "Skill Behavioral Contracts") printf 'goat-critique invocation' ;;
        "Reference Budgets") printf 'ADR-023 headroom' ;;
        "Cross-Agent Consistency") printf 'execution loop · router table' ;;
        "Instruction Parity Contract") printf 'agent files share contract' ;;
        "Instruction File Quality") printf 'within line budget · no encyclopedia' ;;
        "Tests") printf 'fast suite + coverage' ;;
        "Dependency Audit") printf 'npm audit' ;;
        "GOAT Flow Audit") printf 'all checks' ;;
        "Learning-Loop Schema") printf 'footguns + lessons valid' ;;
        "Content Drift") printf 'cold-path content lint · view-name drift' ;;
        "Doc/Code Drift") printf 'arch counts · setup IDs · code-map' ;;
        "Skill Docs Sync") printf 'templates match installed' ;;
        "Skill SKILL.md Parity") printf 'all installed match' ;;
        "Path Integrity") printf 'internal refs resolve' ;;
        "Markdown Links") printf 'all markdown links resolve' ;;
        "Package README Links") printf 'relative paths · packed files' ;;
        *) printf '' ;;
    esac
}

# ── Live renderer ────────────────────────────────────────────────────
# Each section's collapsed row (and any auto-expansion on FAIL/WARN)
# is printed when the section completes - i.e. when the next section()
# call fires, or when _on_exit runs for the last section. The header
# prints once, lazily, on the first section() call. Phase headings
# print whenever the phase changes between two consecutive sections.
# Widths are computed once from a fixed list of known sections, so the
# columns stay aligned across all rows regardless of which sections
# end up running.

_widths_computed=0
_header_printed=0
_last_phase=""
NAME_W=10
DESC_W=10
ELAPSED_W=6
BLOCK_W=70
SHOW_DESC=1
SHOW_ELAPSED=1
RULE_TOP_LINE=""
RULE_MID_LINE=""

_repeat() {
    local ch="$1" n="$2" out=""
    local i=0
    while (( i < n )); do out+="$ch"; i=$((i + 1)); done
    printf '%s' "$out"
}

# printf %-*s measures bytes, so multi-byte UTF-8 (·, …) breaks
# alignment. _pad_right / _pad_left use ${#s} (character count in
# UTF-8 locales) and pad with explicit spaces.
_pad_right() {
    local s="$1" w="$2" len=${#1}
    printf '%s' "$s"
    if (( len < w )); then printf '%*s' $((w - len)) ''; fi
}
_pad_left() {
    local s="$1" w="$2" len=${#1}
    if (( len < w )); then printf '%*s' $((w - len)) ''; fi
    printf '%s' "$s"
}

# Truncate $1 to width $2 (character count) with an ellipsis if it
# would overflow. Bash slicing is character-aware in UTF-8 locales.
_truncate() {
    local s="$1" w="$2"
    if (( ${#s} <= w )); then
        printf '%s' "$s"
    elif (( w <= 1 )); then
        printf '%s' "${s:0:w}"
    else
        local head=$((w - 1))
        if [[ "$_use_ascii" -eq 1 ]]; then
            printf '%s.' "${s:0:head}"
        else
            printf '%s…' "${s:0:head}"
        fi
    fi
}

# In ASCII mode (or when LANG is non-UTF-8 and we auto-fell-back to
# ASCII), strip `·` from labels so padding via ${#str} (byte count
# under LANG=C) matches what's displayed on screen.
_ascii_safe() {
    if [[ "$_use_ascii" -eq 1 ]]; then
        printf '%s' "${1//·/+}"
    else
        printf '%s' "$1"
    fi
}

# Computed once from a hardcoded list of known sections. Adding a
# new section means adding it here AND to phase_for / display_for /
# collapsed_desc_for.
_compute_widths() {
    [[ "$_widths_computed" -eq 1 ]] && return 0
    _widths_computed=1
    local sec disp d
    local known=(
        "Shell Scripts" "TypeScript"
        "Deny Policy" "ADR Enforcement" "Gruff Policy"
        "Agent Config Parity" "Skill and Reference Versions" "Version Consistency"
        "Skill Behavioral Contracts" "Cross-Agent Consistency"
        "Reference Budgets"
        "Instruction Parity Contract" "Instruction File Quality"
        "Tests"
        "GOAT Flow Audit" "Learning-Loop Schema" "Content Drift" "Doc/Code Drift"
        "Skill Docs Sync" "Skill SKILL.md Parity"
        "Path Integrity" "Markdown Links" "Package README Links"
    )
    for sec in "${known[@]}"; do
        disp=$(_ascii_safe "$(display_for "$sec")")
        d=$(_ascii_safe "$(collapsed_desc_for "$sec")")
        (( ${#disp} > NAME_W )) && NAME_W=${#disp}
        (( ${#d} > DESC_W )) && DESC_W=${#d}
    done
    (( NAME_W > 24 )) && NAME_W=24
    (( DESC_W > 40 )) && DESC_W=40

    local fixed=$((2 + 1 + 1))
    local row_full=$((fixed + NAME_W + 2 + DESC_W + 2 + ELAPSED_W))
    SHOW_DESC=1
    SHOW_ELAPSED=1
    if (( row_full > _term_cols )); then SHOW_DESC=0; fi
    if (( fixed + NAME_W + 2 + ELAPSED_W > _term_cols )); then SHOW_ELAPSED=0; fi

    BLOCK_W=$row_full
    (( SHOW_DESC == 0 )) && BLOCK_W=$((fixed + NAME_W + 2 + ELAPSED_W))
    (( SHOW_ELAPSED == 0 && SHOW_DESC == 0 )) && BLOCK_W=$((fixed + NAME_W))
    (( SHOW_ELAPSED == 0 && SHOW_DESC == 1 )) && BLOCK_W=$((fixed + NAME_W + 2 + DESC_W))
    (( BLOCK_W > _term_cols )) && BLOCK_W=$_term_cols
    (( BLOCK_W < 30 )) && BLOCK_W=30

    RULE_TOP_LINE=$(_repeat "$RULE_TOP" "$BLOCK_W")
    RULE_MID_LINE=$(_repeat "$RULE_MID" "$BLOCK_W")
}

_emit_header_once() {
    [[ "$_header_printed" -eq 1 ]] && return 0
    _header_printed=1
    _compute_widths

    local repo_name branch pkg_version version_label title
    repo_name=$(basename "$ROOT_DIR")
    branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)
    version_label=""
    if [[ -f package.json ]]; then
        pkg_version=$(grep -oE '"version":[[:space:]]*"[^"]+"' package.json | head -1 | sed -E 's/.*"([^"]+)"$/\1/' || true)
        [[ -n "${pkg_version:-}" ]] && version_label="v$pkg_version"
    fi
    title=" preflight · $repo_name"
    [[ -n "$branch" ]] && title+=" · $branch"
    title=$(_ascii_safe "$title")

    printf '%s%s%s\n' "$DIM" "$RULE_TOP_LINE" "$RST"
    if [[ -n "$version_label" ]]; then
        local title_len=${#title}
        local ver_len=${#version_label}
        local pad=$(( BLOCK_W - title_len - ver_len - 1 ))
        (( pad < 1 )) && pad=1
        local ver_pad
        ver_pad=$(_repeat ' ' "$pad")
        printf '%s%s%s%s%s%s%s\n' "$CY" "$title" "$RST" "$ver_pad" "$DIM" "$version_label" "$RST"
    else
        printf '%s%s%s\n' "$CY" "$title" "$RST"
    fi
    printf '%s%s%s\n' "$DIM" "$RULE_TOP_LINE" "$RST"
}

_emit_phase_if_changed() {
    local phase="$1"
    if [[ "$phase" != "$_last_phase" ]]; then
        printf '\n %s%s%s\n' "$DIM" "$phase" "$RST"
        _last_phase="$phase"
    fi
    return 0
}

# Aggregate the just-completed section's status from its ledger rows
# and print: collapsed row + (if FAIL/WARN, or --verbose) the indent-
# guide expansion of every sub-row and detail line.
_emit_section_row() {
    local sec="$1"
    [[ -z "$sec" ]] && return 0
    _compute_widths

    local agg status rc el
    agg=$(awk -F '\t' -v target="$sec" '
        BEGIN { st="EMPTY"; rc=0 }
        $1=="SECTION" { in_t=($2==target); next }
        !in_t { next }
        $1=="ROW" {
            rc++
            if ($2=="FAIL") st="FAIL"
            else if ($2=="WARN" && st!="FAIL") st="WARN"
            else if ($2=="PASS" && st!="FAIL" && st!="WARN") st="PASS"
            else if ($2=="SKIP" && st=="EMPTY") st="SKIP"
        }
        END { printf "%s\t%d", st, rc }
    ' "$LEDGER")
    status="${agg%%$'\t'*}"
    rc="${agg##*$'\t'}"

    el=$(awk -F '\t' -v target="$sec" '$1=="ELAPSED" && $2==target { print $3; exit }' "$LEDGER")
    [[ -z "$el" ]] && el=0

    local glyph color disp desc elapsed_str
    case "$status" in
        FAIL)       glyph="$GLYPH_FAIL"; color="$R" ;;
        WARN)       glyph="$GLYPH_WARN"; color="$Y" ;;
        SKIP|EMPTY) glyph="$GLYPH_SKIP"; color="$DIM" ;;
        *)          glyph="$GLYPH_PASS"; color="$G" ;;
    esac
    disp=$(_ascii_safe "$(display_for "$sec")")
    desc=$(_ascii_safe "$(collapsed_desc_for "$sec")")
    elapsed_str=$(fmt_elapsed "$el")
    disp=$(_truncate "$disp" "$NAME_W")
    desc=$(_truncate "$desc" "$DESC_W")

    printf '  %s%s%s  ' "$color" "$glyph" "$RST"
    _pad_right "$disp" "$NAME_W"
    if (( SHOW_DESC == 1 )); then
        printf '  '
        _pad_right "$desc" "$DESC_W"
    fi
    if (( SHOW_ELAPSED == 1 )); then
        printf '  %s' "$DIM"
        _pad_left "$elapsed_str" "$ELAPSED_W"
        printf '%s' "$RST"
    fi
    printf '\n'

    local expand=0
    (( verbose == 1 )) && expand=1
    [[ "$status" == "FAIL" || "$status" == "WARN" ]] && expand=1
    if (( expand == 1 )) && (( rc > 0 )); then
        printf '     %s%s%s\n' "$DIM" "$GUIDE" "$RST"
        awk -F '\t' -v target="$sec" '
            BEGIN { in_target = 0 }
            $1 == "SECTION" { in_target = ($2 == target); next }
            !in_target { next }
            $1 == "ROW"    { printf "ROW\t%s\t%s\n", $2, $4 }
            $1 == "DETAIL" { printf "DETAIL\t%s\n", $3 }
        ' "$LEDGER" | while IFS=$'\t' read -r kind a b; do
            if [[ "$kind" == "ROW" ]]; then
                local sub_glyph sub_color
                case "$a" in
                    FAIL) sub_glyph="$GLYPH_FAIL"; sub_color="$R" ;;
                    WARN) sub_glyph="$GLYPH_WARN"; sub_color="$Y" ;;
                    SKIP) sub_glyph="$GLYPH_SKIP"; sub_color="$DIM" ;;
                    *)    sub_glyph="$GLYPH_PASS"; sub_color="$G" ;;
                esac
                printf '     %s%s%s  %s%s%s  %s\n' "$DIM" "$GUIDE" "$RST" "$sub_color" "$sub_glyph" "$RST" "$b"
            elif [[ "$kind" == "DETAIL" ]]; then
                printf '     %s%s%s        %s%s%s\n' "$DIM" "$GUIDE" "$RST" "$DIM" "$a" "$RST"
            fi
        done
        printf '     %s%s%s\n' "$DIM" "$GUIDE" "$RST"
    fi
    return 0
}

_emit_footer() {
    _compute_widths
    local total_elapsed verdict verdict_color sep
    total_elapsed=$(fmt_elapsed $(( $(now_ms) - preflight_start )))
    if [[ "$errors" -gt 0 ]]; then
        verdict="FAIL"; verdict_color="$R"
    elif [[ "$warnings" -gt 0 ]]; then
        verdict="PASS (with warnings)"; verdict_color="$Y"
    else
        verdict="PASS"; verdict_color="$G"
    fi
    sep="·"
    [[ "$_use_ascii" -eq 1 ]] && sep="+"
    printf '%s%s%s\n' "$DIM" "$RULE_MID_LINE" "$RST"
    printf ' %s%s%s%s   %d checks %s %d warnings %s %s%s\n' \
        "$BOLD" "$verdict_color" "$verdict" "$RST" \
        "$checks" "$sep" "$warnings" "$sep" "$total_elapsed" "$RST"
    printf '%s%s%s\n' "$DIM" "$RULE_MID_LINE" "$RST"
}

# ── Shell Scripts ────────────────────────────────────────────────────
section "Shell Scripts"
if bash -n scripts/*.sh scripts/maintenance/*.sh scripts/installers/*.sh 2>/dev/null; then
    pass "Bash syntax (scripts)"
else
    fail "Bash syntax check (scripts)"
fi

# Also syntax-check installed hooks
while IFS= read -r hookdir; do
    if compgen -G "$hookdir/*.sh" >/dev/null 2>&1; then
        if bash -n "$hookdir"/*.sh 2>/dev/null; then
            pass "Bash syntax ($hookdir/)"
        else
            fail "Bash syntax check ($hookdir/)"
        fi
    fi
done < <(manifest_eval hook-dirs)

if command -v shellcheck >/dev/null 2>&1; then
    if shellcheck --exclude=SC2001 scripts/*.sh scripts/maintenance/*.sh scripts/installers/*.sh >/dev/null 2>&1; then
        pass "Shellcheck (scripts)"
    else
        fail "Shellcheck (scripts) - run shellcheck scripts/*.sh scripts/maintenance/*.sh scripts/installers/*.sh for details"
    fi

    # Also shellcheck installed hooks (SC2016 excluded: sed patterns intentionally use single quotes)
    while IFS= read -r hookdir; do
        if compgen -G "$hookdir/*.sh" >/dev/null 2>&1; then
            if shellcheck --exclude=SC2001,SC2016 "$hookdir"/*.sh >/dev/null 2>&1; then
                pass "Shellcheck ($hookdir/)"
            else
                fail "Shellcheck ($hookdir/) - run shellcheck $hookdir/*.sh for details"
            fi
        fi
    done < <(manifest_eval hook-dirs)
else
    warn "Shellcheck not installed - run: bash scripts/setup-initial.sh"
fi

# ── Deny Policy ──────────────────────────────────────────────────────
section "Deny Policy"
if deny_self_test_output=$(bash workflow/hooks/deny-dangerous.sh --self-test=full 2>&1); then
    pass "workflow/hooks/deny-dangerous.sh ${deny_self_test_output}"
else
    fail "workflow/hooks/deny-dangerous.sh full self-test"
fi

# Also smoke-test installed hooks. Routine audit/preflight only needs the
# install-safe representative set; the local scripts/ copy runs the full corpus
# above.
while IFS= read -r hookdir; do
    if [[ -f "$hookdir/deny-dangerous.sh" ]]; then
        if bash "$hookdir/deny-dangerous.sh" --self-test=smoke >/dev/null 2>&1; then
            pass "$hookdir/deny-dangerous.sh smoke self-test"
        else
            fail "$hookdir/deny-dangerous.sh smoke self-test"
        fi
    fi
done < <(manifest_eval hook-dirs)

# Runtime smoke test: pipe a known-blocked command through installed deny hooks
while IFS= read -r hookdir; do
    if [[ -f "$hookdir/deny-dangerous.sh" ]]; then
        if [[ "$hookdir" == ".github/hooks" ]]; then
            test_payload='{"toolName":"bash","toolArgs":"{\"command\":\"rm -rf /\"}"}'
            if output=$(bash "$hookdir/deny-dangerous.sh" <<< "$test_payload" 2>&1); then
                if echo "$output" | grep -q '"permissionDecision":"deny"'; then
                    pass "$hookdir/deny-dangerous.sh runtime smoke test (copilot payload denied rm -rf)"
                else
                    fail "$hookdir/deny-dangerous.sh did not return a deny decision for Copilot payload"
                fi
            else
                exit_code=$?
                warn "$hookdir/deny-dangerous.sh exited $exit_code on Copilot deny payload (expected 0 + deny JSON)"
            fi
        elif [[ "$hookdir" == ".agents/hooks" ]]; then
            test_payload='{"hookEventName":"PreToolUse","toolCall":{"name":"run_command","args":{"CommandLine":"rm -rf /"}}}'
            if output=$(bash "$hookdir/deny-dangerous.sh" <<< "$test_payload" 2>&1); then
                if echo "$output" | grep -q '"decision":"deny"'; then
                    pass "$hookdir/deny-dangerous.sh runtime smoke test (antigravity payload denied rm -rf)"
                else
                    fail "$hookdir/deny-dangerous.sh did not return a deny decision for Antigravity payload"
                fi
            else
                exit_code=$?
                warn "$hookdir/deny-dangerous.sh exited $exit_code on Antigravity deny payload (expected 0 + deny JSON)"
            fi
        else
            # Simulate a VS Code-style Bash tool call with a dangerous command
            test_payload='{"tool_name":"Bash","tool_input":{"command":"rm -rf /"}}'
            if bash "$hookdir/deny-dangerous.sh" <<< "$test_payload" >/dev/null 2>&1; then
                fail "$hookdir/deny-dangerous.sh did not block 'rm -rf /' (exit 0)"
            else
                exit_code=$?
                if [[ $exit_code -eq 2 ]]; then
                    pass "$hookdir/deny-dangerous.sh runtime smoke test (blocked rm -rf)"
                else
                    warn "$hookdir/deny-dangerous.sh exited $exit_code on blocked command (expected 2)"
                fi
            fi
        fi
    fi
done < <(manifest_eval hook-dirs)

# Runtime smoke test the exact command strings in installed agent configs. This
# catches failures before the guard script starts, including stale paths and
# exit-127 command-shape regressions.
configured_hook_smoke_output=$(
    node <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const guardScripts = ["deny-dangerous.sh"];
const configs = [
  { agent: "claude", path: ".claude/settings.json", mode: "stderr" },
  { agent: "codex", path: ".codex/hooks.json", mode: "stderr" },
  { agent: "antigravity", path: ".agents/hooks.json", mode: "antigravity-json" },
  { agent: "copilot", path: ".github/hooks/hooks.json", mode: "copilot-json" },
];

function emit(status, message) {
  console.log(`${status}\t${message}`);
}

function payloadFor(mode, script) {
  const command = "git push origin main";
  if (mode === "copilot-json") {
    return {
      input: JSON.stringify({ toolName: "bash", toolArgs: { command } }),
      status: 0,
      stream: "stdout",
      pattern: /"permissionDecision"\s*:\s*"deny"/,
    };
  }
  if (mode === "antigravity-json") {
    return {
      input: JSON.stringify({
        hookEventName: "PreToolUse",
        toolCall: { name: "run_command", args: { CommandLine: command } },
      }),
      status: 0,
      stream: "stdout",
      pattern: /"decision"\s*:\s*"deny"/,
    };
  }
  return {
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }),
    status: 2,
    stream: "stderr",
    pattern: /BLOCKED:/,
  };
}

function collect(value, out = []) {
  if (Array.isArray(value)) {
    for (const item of value) collect(item, out);
    return out;
  }
  if (!value || typeof value !== "object") return out;
  for (const key of ["command", "bash"]) {
    if (typeof value[key] !== "string") continue;
    const script = guardScripts.find((name) => value[key].includes(name));
    if (script) out.push({ command: value[key], script });
  }
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") collect(child, out);
  }
  return out;
}

function smokeCwds(agent) {
  const root = process.cwd();
  const cwds = [{ label: "project root", cwd: root }];
  if (agent === "copilot") return cwds;
  const nested = path.join(root, ".goat-flow");
  if (fs.existsSync(nested)) cwds.push({ label: ".goat-flow", cwd: nested });
  return cwds;
}

function runCommand(command, input, cwd) {
  return spawnSync("bash", ["-c", `printf %s "$GOAT_HOOK_SMOKE_PAYLOAD" | { ${command}; }`], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GOAT_HOOK_SMOKE_PAYLOAD: input },
    input: "",
    timeout: 5000,
  });
}

function spawnFailureMessage(result, label) {
  if (!result.error) return null;
  if (typeof result.status === "number") return null;
  const code = result.error.code ? `${result.error.code}: ` : "";
  return `${label} could not spawn (${code}${result.error.message}). The current sandbox or permission profile may block child-process execution.`;
}

let checked = 0;
for (const config of configs) {
  if (!fs.existsSync(config.path)) {
    emit("SKIP", `${config.agent}: hook config missing (${config.path})`);
    continue;
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(config.path, "utf8"));
  } catch (error) {
    emit("FAIL", `${config.agent}: hook config JSON parse failed (${error.message})`);
    continue;
  }
  const seen = new Set();
  const commands = collect(parsed).filter((entry) => {
    const key = `${entry.command}\0${entry.script}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (commands.length === 0) {
    emit("FAIL", `${config.agent}: no configured guard hook commands found in ${config.path}`);
    continue;
  }
  for (const entry of commands) {
    checked += 1;
    const smoke = payloadFor(config.mode, entry.script);
    for (const smokeCwd of smokeCwds(config.agent)) {
      const result = runCommand(entry.command, smoke.input, smokeCwd.cwd);
      const spawnFailure = spawnFailureMessage(
        result,
        `${config.agent}: ${entry.script} configured command`,
      );
      if (spawnFailure) {
        emit("FAIL", spawnFailure);
        continue;
      }
      const status = result.status ?? (result.error ? -1 : 0);
      if (status === 126 || status === 127) {
        emit("FAIL", `${config.agent}: ${entry.script} configured command exited ${status} from ${smokeCwd.label}: ${entry.command}`);
        continue;
      }
      const stream = smoke.stream === "stdout" ? result.stdout : result.stderr;
      if (status === smoke.status && smoke.pattern.test(stream)) {
        emit("PASS", `${config.agent}: ${entry.script} configured command smoke denied payload from ${smokeCwd.label}`);
      } else {
        emit("FAIL", `${config.agent}: ${entry.script} configured command smoke failed from ${smokeCwd.label} (exit ${status})`);
      }
    }
  }
}
if (checked === 0) emit("SKIP", "No configured guard hook commands checked");
NODE
)
while IFS=$'\t' read -r status message; do
    [[ -z "${status:-}" ]] && continue
    case "$status" in
        PASS) pass "$message" ;;
        FAIL) fail "$message" ;;
        SKIP) skip "$message" ;;
        *) fail "Configured hook smoke emitted unexpected result: $status $message" ;;
    esac
done <<< "$configured_hook_smoke_output"

# ── Agent Config Parity ──────────────────────────────────────────────
section "Agent Config Parity"
agent_config_output=$(
    node - "$MANIFEST_PATH" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const manifestPath = process.argv[2];
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

function exists(file) {
  return typeof file === "string" && file.length > 0 && fs.existsSync(file);
}

function templateForSettings(agentId, settingsPath) {
  const ext = path.posix.extname(settingsPath).replace(/^\./, "");
  return `workflow/hooks/agent-config/${agentId}.${ext}`;
}

function templateForHookConfig(agentId) {
  return `workflow/hooks/agent-config/${agentId}-hooks.json`;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function covers(actual, required) {
  if (Array.isArray(required)) {
    return (
      Array.isArray(actual) &&
      required.every((item) => actual.some((candidate) => covers(candidate, item)))
    );
  }
  if (required && typeof required === "object") {
    return (
      actual &&
      typeof actual === "object" &&
      !Array.isArray(actual) &&
      Object.keys(required).every(
        (key) => Object.hasOwn(actual, key) && covers(actual[key], required[key]),
      )
    );
  }
  return Object.is(actual, required);
}

function describeValue(value) {
  if (typeof value === "string") return value;
  return stableJson(value);
}

function collectMissing(required, actual, location, missing) {
  if (Array.isArray(required)) {
    if (!Array.isArray(actual)) {
      missing.push(`${location} is not an array`);
      return;
    }
    for (const item of required) {
      if (!actual.some((candidate) => covers(candidate, item))) {
        missing.push(`${location} missing ${describeValue(item)}`);
      }
    }
    return;
  }
  if (required && typeof required === "object") {
    if (!actual || typeof actual !== "object" || Array.isArray(actual)) {
      missing.push(`${location} is not an object`);
      return;
    }
    for (const [key, value] of Object.entries(required)) {
      if (!Object.hasOwn(actual, key)) {
        missing.push(`${location}.${key} missing`);
      } else {
        collectMissing(value, actual[key], `${location}.${key}`, missing);
      }
    }
    return;
  }
  if (!Object.is(actual, required)) {
    missing.push(`${location} expected ${describeValue(required)}`);
  }
}

function compareJson(templatePath, installedPath) {
  const required = JSON.parse(fs.readFileSync(templatePath, "utf8"));
  const installed = JSON.parse(fs.readFileSync(installedPath, "utf8"));
  const missing = [];
  collectMissing(required, installed, "$", missing);
  return missing;
}

function normalizeTomlEntries(file) {
  let section = "";
  const entries = [];
  for (const line of fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*/, "").trim())
    .filter(Boolean)
    .map((line) => line.replace(/\s*=\s*/g, " = ").replace(/\s+/g, " "))) {
    const sectionMatch = line.match(/^\[([A-Za-z0-9_.-]+)\]$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      entries.push(`[${section}]`);
      continue;
    }
    const keyMatch = line.match(/^([A-Za-z0-9_.-]+) = (.*)$/);
    entries.push(keyMatch && section ? `${section}.${line}` : line);
  }
  return entries;
}

function compareToml(templatePath, installedPath) {
  const installed = new Set(normalizeTomlEntries(installedPath));
  return normalizeTomlEntries(templatePath)
    .filter((line) => !installed.has(line))
    .map((line) => `$ missing ${line}`);
}

function parseTomlInlineStringTable(value) {
  const entries = [];
  const entryPattern = /"((?:\\.|[^"\\])*)"\s*=\s*"((?:\\.|[^"\\])*)"/gu;
  for (const match of value.matchAll(entryPattern)) {
    entries.push({ pattern: match[1], mode: match[2] });
  }
  return entries;
}

function collectCodexWorkspaceRootEntries(file) {
  const entries = [];
  let section = "";
  for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    if (!line) continue;
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      continue;
    }
    const inlineMatch = line.match(/^":workspace_roots"\s*=\s*(\{.*\})$/);
    if (inlineMatch) {
      entries.push(...parseTomlInlineStringTable(inlineMatch[1]));
      continue;
    }
    if (section.endsWith('filesystem.":workspace_roots"')) {
      entries.push(...parseTomlInlineStringTable(line));
    }
  }
  return entries;
}

function collectMissingCodexExactWorkspaceRootPaths(installedPath) {
  return collectCodexWorkspaceRootEntries(installedPath)
    .map((entry) => entry.pattern)
    .filter((pattern) => pattern && pattern !== "." && !pattern.includes("*"))
    .filter((pattern) => !fs.existsSync(pattern));
}

function compareConfig(templatePath, installedPath) {
  if (templatePath.endsWith(".json")) return compareJson(templatePath, installedPath);
  if (templatePath.endsWith(".toml")) return compareToml(templatePath, installedPath);
  return fs.readFileSync(templatePath, "utf8").trimEnd() ===
    fs.readFileSync(installedPath, "utf8").trimEnd()
    ? []
    : ["$ content differs from template"];
}

function emit(status, message) {
  console.log(`${status}\t${message}`);
}

let checked = 0;
for (const [agentId, agent] of Object.entries(manifest.agents || {})) {
  const settingsPath =
    typeof agent.settings === "string" ? agent.settings : "";
  const hookConfigPath =
    typeof agent.hook_config_file === "string" ? agent.hook_config_file : "";
  const specs = [];

  if (settingsPath) {
    specs.push({
      agentId,
      templatePath: templateForSettings(agentId, settingsPath),
      installedPath: settingsPath,
    });
  }
  if (hookConfigPath && hookConfigPath !== settingsPath) {
    specs.push({
      agentId,
      templatePath: templateForHookConfig(agentId),
      installedPath: hookConfigPath,
    });
  }

  for (const spec of specs) {
    checked += 1;
    if (!exists(spec.templatePath)) {
      emit("FAIL", `${spec.agentId}: missing template ${spec.templatePath}`);
      continue;
    }
    if (!exists(spec.installedPath)) {
      emit("FAIL", `${spec.agentId}: missing installed config ${spec.installedPath}`);
      continue;
    }
    try {
      const missing = compareConfig(spec.templatePath, spec.installedPath);
      if (spec.agentId === "codex" && spec.installedPath.endsWith("config.toml")) {
        for (const missingPath of collectMissingCodexExactWorkspaceRootPaths(spec.installedPath)) {
          missing.push(`${spec.installedPath} lists absent exact workspace root ${missingPath}`);
        }
      }
      if (missing.length === 0) {
        emit(
          "PASS",
          `${spec.agentId}: ${spec.installedPath} includes required entries from ${spec.templatePath}`,
        );
      } else {
        const summary = missing.slice(0, 5).join("; ");
        const suffix = missing.length > 5 ? `; +${missing.length - 5} more` : "";
        emit(
          "FAIL",
          `${spec.agentId}: ${spec.installedPath} missing required entries from ${spec.templatePath}: ${summary}${suffix}`,
        );
      }
    } catch (error) {
      emit(
        "FAIL",
        `${spec.agentId}: could not compare ${spec.templatePath} to ${spec.installedPath}: ${error.message}`,
      );
    }
  }
}

if (checked === 0) emit("SKIP", "No agent config files declared in manifest");
NODE
)
while IFS=$'\t' read -r status message; do
    if [[ -z "${status:-}" ]]; then
        continue
    fi
    case "$status" in
        PASS) pass "$message" ;;
        FAIL) fail "$message" ;;
        SKIP) skip "$message" ;;
        *) fail "Agent config parity emitted unexpected result: $status $message" ;;
    esac
done <<< "$agent_config_output"

# ── Skill and Reference Versions ─────────────────────────────────────
section "Skill and Reference Versions"
skill_version=$(node -e "console.log(require('./package.json').version)" 2>/dev/null || true)
if [[ -z "$skill_version" ]]; then
    note "Could not read version from package.json"
else
    template_fail=0
    while IFS= read -r -d '' f; do
        ver=$(grep -o 'goat-flow-skill-version: "[^"]*"' "$f" | grep -o '"[^"]*"' | tr -d '"' || true)
        if [[ "$ver" != "$skill_version" ]]; then
            fail "Skill template $f has version '$ver', expected '$skill_version'"
            template_fail=1
        fi
    done < <(find workflow/skills -maxdepth 2 -name 'SKILL.md' -print0)
    if [[ "$template_fail" -eq 0 ]]; then
        pass "All workflow skill templates at version $skill_version"
    fi

    # Installed skill copies must also match
    installed_fail=0
    while IFS= read -r dir; do
        if [[ -d "$dir" ]]; then
            while IFS= read -r -d '' f; do
                ver=$(grep -o 'goat-flow-skill-version: "[^"]*"' "$f" | grep -o '"[^"]*"' | tr -d '"' || true)
                if [[ -n "$ver" ]] && [[ "$ver" != "$skill_version" ]]; then
                    fail "Installed skill $f has version '$ver', expected '$skill_version'"
                    installed_fail=1
                fi
            done < <(find "$dir" -name 'SKILL.md' -print0)
        fi
    done < <(manifest_eval skill-roots)
    if [[ "$installed_fail" -eq 0 ]]; then
        pass "All installed skills at version $skill_version"
    fi

    reference_fail=0
    while IFS= read -r -d '' f; do
        ver=$(grep -o 'goat-flow-reference-version: "[^"]*"' "$f" | grep -o '"[^"]*"' | tr -d '"' || true)
        if [[ "$ver" != "$skill_version" ]]; then
            fail "Reference template $f has version '$ver', expected '$skill_version'"
            reference_fail=1
        fi
    done < <(find workflow/skills/reference -type f -name '*.md' -print0)
    while IFS= read -r -d '' f; do
        ver=$(grep -o 'goat-flow-reference-version: "[^"]*"' "$f" | grep -o '"[^"]*"' | tr -d '"' || true)
        if [[ "$ver" != "$skill_version" ]]; then
            fail "Reference template $f has version '$ver', expected '$skill_version'"
            reference_fail=1
        fi
    done < <(find workflow/skills -path '*/references/*.md' -print0)
    if [[ "$reference_fail" -eq 0 ]]; then
        pass "All workflow reference templates at version $skill_version"
    fi

    installed_reference_fail=0
    for installed_dir in .goat-flow/skill-docs .goat-flow/skill-docs/playbooks; do
        if [[ -d "$installed_dir" ]]; then
            while IFS= read -r -d '' f; do
                ver=$(grep -o 'goat-flow-reference-version: "[^"]*"' "$f" | grep -o '"[^"]*"' | tr -d '"' || true)
                if [[ "$ver" != "$skill_version" ]]; then
                    fail "Installed shared reference $f has version '$ver', expected '$skill_version'"
                    installed_reference_fail=1
                fi
            done < <(find "$installed_dir" -type f -name '*.md' -print0)
        fi
    done
    while IFS= read -r dir; do
        if [[ -d "$dir" ]]; then
            while IFS= read -r -d '' f; do
                ver=$(grep -o 'goat-flow-reference-version: "[^"]*"' "$f" | grep -o '"[^"]*"' | tr -d '"' || true)
                if [[ "$ver" != "$skill_version" ]]; then
                    fail "Installed skill reference $f has version '$ver', expected '$skill_version'"
                    installed_reference_fail=1
                fi
            done < <(find "$dir" -path '*/references/*.md' -print0)
        fi
    done < <(manifest_eval skill-roots)
    if [[ "$installed_reference_fail" -eq 0 ]]; then
        pass "All installed references at version $skill_version"
    fi

    # Shipped test fixtures: the installer round-trip integration test copies
    # these into a temp repo and runs preflight there. Catching stale versions
    # here avoids a 30s+ round-trip just to learn the fixture drifted.
    # Dynamic stale-version fixtures created programmatically inside tests
    # are not on disk under test/fixtures/, so this scan only hits real ones.
    if [[ -d test/fixtures ]]; then
        fixtures_fail=0
        while IFS= read -r -d '' f; do
            ver=$(grep -o 'goat-flow-skill-version: "[^"]*"' "$f" | grep -o '"[^"]*"' | tr -d '"' || true)
            if [[ -n "$ver" ]] && [[ "$ver" != "$skill_version" ]]; then
                fail "Test fixture $f has version '$ver', expected '$skill_version'"
                fixtures_fail=1
            fi
        done < <(find test/fixtures -name 'SKILL.md' -print0)
        while IFS= read -r -d '' f; do
            ver=$(grep -o 'goat-flow-reference-version: "[^"]*"' "$f" | grep -o '"[^"]*"' | tr -d '"' || true)
            if [[ "$ver" != "$skill_version" ]]; then
                fail "Test fixture reference $f has version '$ver', expected '$skill_version'"
                fixtures_fail=1
            fi
        done < <(find test/fixtures -path '*/references/*.md' -print0)
        if [[ "$fixtures_fail" -eq 0 ]]; then
            pass "All test fixture skills and references at version $skill_version"
        fi
    fi
fi

# Derive instruction file list from manifest once, reuse across sections
agent_files=()
if manifest_agent_lines=$(node -e "const m=require('./workflow/manifest.json');for(const a of Object.values(m.agents))console.log(a.instruction_file)" 2>/dev/null); then
    while IFS= read -r af; do
        [[ -f "$af" ]] && agent_files+=("$af")
    done <<< "$manifest_agent_lines"
else
    warn "Could not read agent profiles from workflow/manifest.json - instruction-file checks will be skipped"
fi

# ── Version Consistency ──────────────────────────────────────────────
section "Version Consistency"
if [[ -f package.json ]]; then
    pkg_version=$(node -e "console.log(require('./package.json').version)")
    pass "package.json ($pkg_version)"

    # AUDIT_VERSION derives from package.json - no separate version.ts to check

    # .goat-flow/config.yaml version should match package version
    if [[ -f .goat-flow/config.yaml ]]; then
        config_version=$(grep '^version:' .goat-flow/config.yaml | grep -oE '"[^"]+"' | tr -d '"' || true)
        if [[ -n "$config_version" ]]; then
            if [[ "$config_version" != "$pkg_version" ]]; then
                fail ".goat-flow/config.yaml version ($config_version) does not match package.json ($pkg_version)"
            else
                pass ".goat-flow/config.yaml version ($config_version)"
            fi
        else
            fail ".goat-flow/config.yaml has no version field"
        fi
    fi

    # Instruction file headers must match package version
    for ifile in "${agent_files[@]}"; do
        header_version=$(head -1 "$ifile" | grep -oE 'v[0-9]+\.[0-9]+(\.[0-9]+)?' | sed 's/^v//' || true)
        if [[ -n "$header_version" ]] && [[ "$header_version" != "$pkg_version" ]]; then
            fail "$ifile header says v${header_version}, expected v${pkg_version}"
        fi
    done
else
    skip "Version check (missing package.json)"
fi

# ── Skill Behavioral Contracts ───────────────────────────────────────
section "Skill Behavioral Contracts"
contract_ok=true
bad_goat_critique_patterns=(
    "Exception: on C""odex"
    "C""odex requires ""explicit user ""delegation ""consent"
    "confirm ""delegation ""consent once ""before spawning"
)
goat_critique_files=("workflow/skills/goat-critique/SKILL.md")
while IFS= read -r agent_dir; do
    [[ -d "$agent_dir" ]] || continue
    goat_critique_files+=("${agent_dir}/goat-critique/SKILL.md")
done < <(manifest_eval skill-roots)

for f in "${goat_critique_files[@]}"; do
    [[ -f "$f" ]] || continue
    for pattern in "${bad_goat_critique_patterns[@]}"; do
        if grep -Fq "$pattern" "$f"; then
            fail "$f contains obsolete goat-critique delegation exception: $pattern"
            contract_ok=false
        fi
    done
done
if [[ "$contract_ok" == true ]]; then
    pass "goat-critique direct invocation has no obsolete Codex delegation exception"
fi

# ── Reference Budget Headroom ────────────────────────────────────────
section "Reference Budgets"
budget_headroom_output=$(
    node <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const files = [
  { cap: 1500, paths: [
    "workflow/skills/reference/skill-preamble.md",
    ".goat-flow/skill-docs/skill-preamble.md",
    "workflow/skills/reference/skill-conventions.md",
    ".goat-flow/skill-docs/skill-conventions.md",
  ] },
  { cap: 400, paths: [
    "workflow/skills/playbooks/skill-quality-testing.md",
    ".goat-flow/skill-docs/skill-quality-testing/README.md",
  ] },
  { cap: 3000, paths: [
    ...[
      "browser-use.md",
      "changelog.md",
      "code-comments.md",
      "gruff-code-quality.md",
      "observability.md",
      "page-capture.md",
      "release-notes.md",
    ].flatMap((name) => [
      `workflow/skills/playbooks/${name}`,
      `.goat-flow/skill-docs/playbooks/${name}`,
    ]),
    ...[
      "tdd-iteration.md",
      "adversarial-framing.md",
      "deployment.md",
    ].flatMap((name) => [
      `workflow/skills/playbooks/skill-quality-testing/${name}`,
      `.goat-flow/skill-docs/skill-quality-testing/${name}`,
    ]),
  ] },
];

function bodyWordCount(file) {
  const text = fs.readFileSync(file, "utf8").replace(/^---\n[\s\S]*?\n---\n?/, "");
  return text.split(/\s+/).filter(Boolean).length;
}

const near = [];
for (const tier of files) {
  for (const file of tier.paths) {
    if (!fs.existsSync(file)) continue;
    const words = bodyWordCount(file);
    if (words / tier.cap >= 0.9) {
      near.push({ file, words, cap: tier.cap, ratio: words / tier.cap });
    }
  }
}
near.sort((a, b) => b.ratio - a.ratio || a.file.localeCompare(b.file));
process.stdout.write(
  near.map((entry) => `${entry.file} ${entry.words}/${entry.cap}`).join("; "),
);
NODE
)
if [[ -n "$budget_headroom_output" ]]; then
    pass "ADR-023 headroom above 90%: $budget_headroom_output"
else
    pass "No ADR-023 reference files above 90% of their tier cap"
fi

# ── Cross-Agent Loop Consistency ─────────────────────────────────────
if [[ ${#agent_files[@]} -ge 2 ]]; then
    section "Cross-Agent Consistency"
    # Extract execution loop (READ→Autonomy) from each file, normalize, compare word sets
    extract_loop() {
        sed -n '/\*\*READ\*\*\|^##.*READ/,/^## \(Autonomy\|Router\|Hard Rules\|Working Memory\|Definition of Done\)/p' "$1" \
            | tr '[:upper:]' '[:lower:]' | tr -cs '[:alnum:]' ' ' | tr -s ' '
    }
    ref_loop=$(extract_loop "${agent_files[0]}")
    loop_ok=true
    for af in "${agent_files[@]:1}"; do
        other_loop=$(extract_loop "$af")
        # Simple word-count divergence check (structural drift detection)
        ref_words=$(echo "$ref_loop" | wc -w)
        other_words=$(echo "$other_loop" | wc -w)
        if [[ "$ref_words" -eq 0 ]] || [[ "$other_words" -eq 0 ]]; then
            fail "Execution loop missing in $af - copy from ${agent_files[0]}"
            loop_ok=false
        else
            # Check word count ratio - >40% divergence = structural drift
            diff_pct=$(( (ref_words - other_words) * 100 / ref_words ))
            abs_diff=${diff_pct#-}
            if [[ "$abs_diff" -gt 40 ]]; then
                fail "Execution loop in $af diverges from ${agent_files[0]} (${abs_diff}% word count difference)"
                loop_ok=false
            fi
        fi
    done
    if $loop_ok; then
        pass "Execution loops consistent across ${#agent_files[@]} agent files"
    fi

    # Router Table path parity (path-based, not label-based - labels drift
    # across agents but .goat-flow/ paths are consistent)
    router_parity_output=$(
        node - "${agent_files[@]}" <<'NODE'
const fs = require("node:fs");
const files = process.argv.slice(2);

function extractRouterPaths(filepath) {
    const lines = fs.readFileSync(filepath, "utf8").split(/\r?\n/);
    let inSection = false;
    const paths = new Set();
    for (const line of lines) {
        if (/^##\s+Router\s+Table/i.test(line)) { inSection = true; continue; }
        if (inSection && /^##\s/.test(line)) break;
        if (!inSection) continue;
        for (const m of line.matchAll(/`([^`]+)`/g)) {
            const raw = m[1];
            const wasDir = raw.endsWith("/");
            const p = raw.replace(/\/+$/, "");
            if (/^\.(claude|github|agents|codex)\//.test(p)) continue;
            if (p.includes("/") || p.endsWith(".md") || p.endsWith(".yaml") || wasDir) paths.add(p);
        }
    }
    return paths;
}

if (files.length < 3) {
    console.log("PASS\tRouter Table parity: " + files.length + " files present, requires 3+ (noted)");
    process.exit(0);
}

const filePaths = new Map();
for (const f of files) filePaths.set(f, extractRouterPaths(f));

function hasCoverage(pathSet, target) {
    if (pathSet.has(target)) return true;
    // Parent-directory coverage: .goat-flow/skill-docs/ covers
    // .goat-flow/skill-docs/README.md
    for (const p of pathSet) {
        if (target.startsWith(p + "/")) return true;
    }
    return false;
}

const allPaths = new Set();
for (const paths of filePaths.values()) for (const p of paths) allPaths.add(p);

const total = files.length;
const majority = Math.ceil(total / 2);
let ok = true;

for (const p of [...allPaths].sort()) {
    const presentIn = files.filter((f) => hasCoverage(filePaths.get(f), p));
    if (presentIn.length >= majority && presentIn.length < total) {
        const missing = files.filter((f) => !hasCoverage(filePaths.get(f), p));
        for (const m of missing) {
            // Skip self-reference warnings (CLAUDE.md doesn't list itself
            // in its own Peer instructions row)
            const basename = require("node:path").basename(m);
            if (p === basename || p.endsWith("/" + basename)) continue;
            console.log("WARN\tRouter Table path '" + p + "' present in " + presentIn.length + "/" + total + " but missing from " + m);
            ok = false;
        }
    }
}
if (ok) console.log("PASS\tRouter Table path parity across " + total + " agent files");
NODE
    )
    while IFS=$'\t' read -r status message; do
        [[ -z "${status:-}" ]] && continue
        case "$status" in
            PASS) pass "$message" ;;
            WARN) warn "$message" ;;
            FAIL) fail "$message" ;;
        esac
    done <<< "$router_parity_output"
fi

# ── Instruction Parity Contract ──────────────────────────────────────
section "Instruction Parity Contract"
if [[ -f scripts/check-instruction-parity.mjs ]]; then
    parity_output=$(node scripts/check-instruction-parity.mjs 2>&1) && parity_exit=0 || parity_exit=$?
    if [[ "$parity_exit" -eq 0 ]]; then
        pass "$parity_output"
    else
        fail "Instruction parity check failed (exit $parity_exit)"
        echo "$parity_output" | head -12 | details_pipe
    fi
else
    skip "Instruction parity check (scripts/check-instruction-parity.mjs missing)"
fi

# ── Instruction File Quality ────────────────────────────────────────
section "Instruction File Quality"

# Line-count check (thresholds from manifest, not hard-coded)
line_target=$(node -e "console.log(require('./workflow/manifest.json').instruction_file.line_target)" 2>/dev/null || echo "125")
line_limit=$(node -e "console.log(require('./workflow/manifest.json').instruction_file.line_limit)" 2>/dev/null || echo "150")

for ifile in "${agent_files[@]}"; do
    count=$(wc -l < "$ifile")
    if [[ "$count" -gt "$line_limit" ]]; then
        fail "$ifile exceeds line limit ($count lines, limit $line_limit)"
    elif [[ "$count" -gt "$line_target" ]]; then
        warn "$ifile exceeds line target ($count lines, target $line_target)"
    else
        pass "$ifile ($count lines, target $line_target)"
    fi
done

# Encyclopedia guard (advisory - downstream projects may have edge cases)
encyclopedia_patterns="database schema|api reference|endpoint list|table definition|historical background|architecture history|full project overview"
enc_ok=true
for ifile in "${agent_files[@]}"; do
    if [[ -f "$ifile" ]]; then
        enc_hits=$(grep -inE "$encyclopedia_patterns" "$ifile" || true)
        if [[ -n "$enc_hits" ]]; then
            while IFS= read -r hit; do
                warn "Encyclopedia content in $ifile: $(echo "$hit" | head -c 120)"
                enc_ok=false
            done <<< "$enc_hits"
        fi
    fi
done
if $enc_ok; then
    pass "No encyclopedia content in instruction files"
fi

# ── TypeScript ───────────────────────────────────────────────────────
if [[ -f tsconfig.json ]]; then
    section "TypeScript"

    if npx tsc 2>/dev/null; then
        pass "Typecheck + build (dist/ produced)"
    else
        fail "Typecheck/build - run npx tsc for details"
    fi

    # Dashboard TypeScript (excluded from main tsconfig.json)
    if [[ -f tsconfig.dashboard.json ]]; then
        if npx tsc -p tsconfig.dashboard.json --noEmit 2>/dev/null; then
            pass "Dashboard typecheck (tsconfig.dashboard.json)"
        else
            fail "Dashboard typecheck failed - run npx tsc -p tsconfig.dashboard.json --noEmit for details"
        fi
    fi

    # ESLint (type-checked rules)
    if command -v npx >/dev/null 2>&1 && [[ -f eslint.config.mjs ]]; then
        lint_targets=(src/cli src/dashboard)
        lint_output=$(npx eslint "${lint_targets[@]}" 2>&1) && lint_exit=0 || lint_exit=$?
        # Count only diagnostic rows, not ESLint's summary/fixability footer.
        lint_errors=$(echo "$lint_output" | grep -Ec '^[[:space:]]*[0-9]+:[0-9]+[[:space:]]+error[[:space:]]' || true)
        lint_warnings=$(echo "$lint_output" | grep -Ec '^[[:space:]]*[0-9]+:[0-9]+[[:space:]]+warning[[:space:]]' || true)
        if [[ "$lint_exit" -eq 0 ]]; then
            if [[ "$lint_warnings" -gt 0 ]]; then
                warn "ESLint (0 errors, $lint_warnings warnings) - run npx eslint ${lint_targets[*]}"
                echo "$lint_output" | sed -n '1,20p' | details_pipe
                if [[ "$lint_warnings" -gt 1 ]]; then
                    warnings=$((warnings + lint_warnings - 1))
                fi
            else
                pass "ESLint (0 warnings)"
            fi
        elif [[ "$lint_errors" -gt 0 ]]; then
            fail "ESLint ($lint_errors errors, $lint_warnings warnings) - run npx eslint ${lint_targets[*]}"
            echo "$lint_output" | sed -n '1,20p' | details_pipe
        else
            pass "ESLint (0 errors, $lint_warnings warnings)"
        fi
    else
        skip "ESLint (not configured)"
    fi

    # Knip (unused exports, dead code - breaking error)
    if command -v npx >/dev/null 2>&1 && npx knip --version >/dev/null 2>&1; then
        knip_output=$(npx knip --no-progress 2>&1) && knip_exit=0 || knip_exit=$?
        if [[ "$knip_exit" -eq 0 ]]; then
            pass "Knip (no unused exports or deps)"
        else
            unused_count=$(echo "$knip_output" | grep -c '^[A-Za-z].*  ' || echo "?")
            fail "Knip: $unused_count unused exports/types - run npx knip for details"
        fi
    else
        skip "Knip (not installed)"
    fi

    # Prettier format check
    if command -v npx >/dev/null 2>&1 && [[ -f node_modules/.bin/prettier ]]; then
        prettier_output=$(bash scripts/prettier-check.sh 2>&1) && prettier_exit=0 || prettier_exit=$?
        if [[ "$prettier_exit" -eq 0 ]]; then
            pass "Prettier (all formatted)"
        else
            unformatted=$(echo "$prettier_output" | grep -c '^\[warn\] [^C]' || echo "?")
            fail "Prettier ($unformatted unformatted files) - run npm run format"
        fi
    else
        skip "Prettier (not installed)"
    fi

    # Quality checks (warnings, not failures)
    # console.log is fine - this is a local CLI tool, not a library

    any_hits=$(grep -rn ': any\b' src/cli/ --include='*.ts' || true)
    [[ -n "$any_hits" ]] && note "Explicit 'any' types ($(echo "$any_hits" | wc -l) hits)"

    # TODO/FIXME check removed (false-positive rate too high in string literals)
fi

# ── Tests ────────────────────────────────────────────────────────────
if [[ -f package.json ]] && grep -q '"test"' package.json; then
    section "Tests"
    test_reports_coverage=false
    test_retryable=false
    coverage_output=""
    if grep -q '"test:coverage"' package.json; then
        test_command=(npm run test:coverage)
        test_label="Tests + coverage"
        test_reports_coverage=true
        test_retryable=true
    elif grep -q '"test:fast"' package.json; then
        test_command=(npm run test:fast)
        test_label="Fast suite"
        test_retryable=true
    else
        test_command=(npm test)
        test_label="All"
    fi
    test_output=""
    test_exit=1
    test_timeout_seconds="${GOAT_FLOW_PREFLIGHT_TEST_TIMEOUT_SECONDS:-600}"
    if [[ "$test_timeout_seconds" =~ ^[0-9]+$ ]]; then
        :
    else
        warn "Invalid GOAT_FLOW_PREFLIGHT_TEST_TIMEOUT_SECONDS=$test_timeout_seconds; using 600"
        test_timeout_seconds=600
    fi
    run_command_capture_with_timeout test_output test_exit "$test_timeout_seconds" "${test_command[@]}"

    test_count=$(echo "$test_output" | grep '# tests' | grep -oE '[0-9]+' || echo "?")
    pass_count=$(echo "$test_output" | grep '# pass' | grep -oE '[0-9]+' || echo "?")
    fail_count=$(echo "$test_output" | grep '# fail' | grep -oE '[0-9]+' || echo "0")

    if [[ "$test_exit" -eq 0 ]] && [[ "$test_count" != "0" ]] && [[ "$test_count" != "?" ]]; then
        pass "$test_label passing ($pass_count/$test_count)"
        coverage_output="$test_output"
    elif [[ "$test_exit" -eq 0 ]] && [[ "$test_count" == "0" || "$test_count" == "?" ]]; then
        warn "No tests found ($pass_count/$test_count) - test suite needs rebuilding"
    elif [[ "$test_exit" -eq 124 ]]; then
        fail "$test_label timed out after ${test_timeout_seconds}s"
        printf '%s\n' "$test_output" | tail -20 | details_pipe || true
    elif [[ "$test_retryable" == true ]]; then
        retry_output=""
        retry_exit=1
        run_command_capture_with_timeout retry_output retry_exit "$test_timeout_seconds" "${test_command[@]}"
        retry_test_count=$(echo "$retry_output" | grep '# tests' | grep -oE '[0-9]+' || echo "?")
        retry_pass_count=$(echo "$retry_output" | grep '# pass' | grep -oE '[0-9]+' || echo "?")
        retry_fail_count=$(echo "$retry_output" | grep '# fail' | grep -oE '[0-9]+' || echo "0")

        if [[ "$retry_exit" -eq 0 ]] && [[ "$retry_test_count" != "0" ]] && [[ "$retry_test_count" != "?" ]]; then
            warn "$test_label passed on retry after initial failure ($retry_pass_count/$retry_test_count); investigate transient test isolation"
            coverage_output="$retry_output"
            printf '%s\n' "$test_output" | grep 'not ok' | head -5 | sed 's/^/initial: /' | details_pipe || true
        elif [[ "$retry_exit" -eq 124 ]]; then
            fail "Tests timed out after retry (initial $fail_count/$test_count failures, retry timed out after ${test_timeout_seconds}s)"
            printf '%s\n' "$test_output" | grep 'not ok' | head -5 | sed 's/^/initial: /' | details_pipe || true
            printf '%s\n' "$retry_output" | tail -20 | sed 's/^/retry: /' | details_pipe || true
        else
            fail "Tests failed after retry (initial $fail_count/$test_count failures, retry $retry_fail_count/$retry_test_count failures)"
            printf '%s\n' "$test_output" | grep 'not ok' | head -5 | sed 's/^/initial: /' | details_pipe || true
            printf '%s\n' "$retry_output" | grep 'not ok' | head -5 | sed 's/^/retry: /' | details_pipe || true
        fi
    else
        fail "Tests failed ($fail_count/$test_count failures)"
        printf '%s\n' "$test_output" | grep 'not ok' | head -5 | details_pipe || true
    fi

    if [[ "$test_reports_coverage" == true && -n "$coverage_output" ]]; then
        if printf '%s\n' "$coverage_output" | grep -Fq '# end of coverage report'; then
            coverage_line=$(printf '%s\n' "$coverage_output" | grep -E '^# all files[[:space:]]*\|' | tail -1 || true)
            if [[ -n "$coverage_line" ]]; then
                line_coverage=$(printf '%s\n' "$coverage_line" | awk -F'|' '{ gsub(/^[ \t]+|[ \t]+$/, "", $2); print $2 }')
                branch_coverage=$(printf '%s\n' "$coverage_line" | awk -F'|' '{ gsub(/^[ \t]+|[ \t]+$/, "", $3); print $3 }')
                function_coverage=$(printf '%s\n' "$coverage_line" | awk -F'|' '{ gsub(/^[ \t]+|[ \t]+$/, "", $4); print $4 }')
                if [[ -n "$line_coverage" && -n "$branch_coverage" && -n "$function_coverage" ]]; then
                    pass "Coverage (line: ${line_coverage}% / branch: ${branch_coverage}% / function: ${function_coverage}%) [fast suite only]"
                else
                    note "Coverage summary unavailable (malformed # all files line)"
                fi
            else
                note "Coverage summary unavailable (missing # all files line)"
            fi
        else
            note "Coverage summary unavailable (missing # end of coverage report)"
        fi
    fi
fi

# ── Dependency Audit ─────────────────────────────────────────────────
if [[ -f package.json ]]; then
    section "Dependency Audit"
    audit_output=$(npm audit 2>&1) && audit_exit=0 || audit_exit=$?
    if [[ "$audit_exit" -eq 0 ]]; then
        pass "npm audit (0 vulnerabilities)"
    else
        vuln_summary=$(printf '%s\n' "$audit_output" | grep -E '^[0-9]+ vulnerabilities? ' | tail -1 || true)
        if [[ -n "$vuln_summary" ]]; then
            fail "npm audit failed - $vuln_summary"
        else
            fail "npm audit failed (exit $audit_exit)"
        fi
        printf '%s\n' "$audit_output" | sed -n '1,20p' | details_pipe
    fi
fi

# ── Removed Patterns (ADR Enforcement) ───────────────────────────────
section "ADR Enforcement"
removed_patterns=(
    "APP.*LIBRARY.*SCRIPT COLLECTION"
    "confusion.log\.md"
    "ProjectShape"
    "detectShape"
    "--shape"
)
adr_clean=true
for pattern in "${removed_patterns[@]}"; do
    hits=$(grep -rn "$pattern" setup/ workflow/ src/ test/ docs/ ai/ .github/ --include='*.md' --include='*.ts' --include='*.yml' 2>/dev/null \
        | grep -v 'CHANGELOG\|TODO_\|ADR-\|design-rationale\|footguns.*RESOLVED\|decisions/\|preflight-checks' || true)
    if [[ -n "$hits" ]]; then
        fail "Removed pattern '$pattern' still found"
        echo "$hits" | head -3 | details_pipe
        adr_clean=false
    fi
done
$adr_clean && pass "No removed patterns found"

# ── Gruff Policy ─────────────────────────────────────────────────────
# Enforces the project rule "never disable gruff-ts rules" structurally
# instead of relying on agent memory (see feedback_gruff_never_disable.md
# and the gruff cleanup work). Findings get fixed, tuned via
# thresholds/allowlists, or baselined with rationale - never silenced via
# `enabled: false`. A single line in .gruff-ts.yaml setting `enabled: false`
# on any rule fails this check.
if [[ -f .gruff-ts.yaml ]]; then
    section "Gruff Policy"
    disabled_lines=$(grep -nE '^[[:space:]]*enabled:[[:space:]]*false' .gruff-ts.yaml || true)
    if [[ -z "$disabled_lines" ]]; then
        pass "No gruff-ts rules disabled (satisfy or tune)"
    else
        fail "gruff-ts rule(s) disabled in .gruff-ts.yaml - satisfy or tune, never silence"
        printf '%s\n' "$disabled_lines" | head -5 | details_pipe
    fi
else
    skip "Gruff Policy (.gruff-ts.yaml not found)"
fi

# ── GOAT Flow Audit ────────────────────────────────────────────────────
if [[ -f dist/cli/cli.js ]]; then
    section "GOAT Flow Audit"
    audit_output=$(node dist/cli/cli.js audit . --format text 2>&1) && audit_exit=0 || audit_exit=$?
    if [[ "$audit_exit" -eq 0 ]]; then
        pass "Audit passes"
    else
        fail "goat-flow audit failed (exit $audit_exit)"
        echo "$audit_output" | head -5 | details_pipe
    fi
else
    skip "GOAT Flow Audit (dist/cli/cli.js not built)"
fi

# ── Learning-Loop Schema ──────────────────────────────────────────────
# Gates footgun schema rules: machine-simple status (active|resolved),
# file:line or (search:) evidence on active entries, resolved-below-section.
if [[ -f dist/cli/cli.js ]]; then
    section "Learning-Loop Schema"
    stats_output=$(node dist/cli/cli.js stats . --check 2>&1) && stats_exit=0 || stats_exit=$?
    if [[ "$stats_exit" -eq 0 ]]; then
        pass "Footgun/lesson schema passes"
    else
        fail "Footgun/lesson schema violations (exit $stats_exit)"
        echo "$stats_output" | head -10 | details_pipe
    fi
else
    skip "Learning-Loop Schema (dist/cli/cli.js not built)"
fi

# ── Content Drift ────────────────────────────────────────────────────
# Sibling auditor: surface `audit --check-content` (cold-path content lint
# + dashboard view-name drift) in the preflight gate so a green preflight
# cannot hide warning-severity drift in code-map.md, docs/dashboard.md, or
# skill-playbook prose.
if [[ -f dist/cli/cli.js ]]; then
    section "Content Drift"
    content_output=$(node dist/cli/cli.js audit . --check-content --format text 2>&1) && content_exit=0 || content_exit=$?
    if [[ "$content_exit" -eq 0 ]]; then
        # exit 0 = no warning-severity drift. INFO findings (e.g.
        # non-actionable-remember) are surfaced inside the audit text but
        # do not gate preflight on their own.
        info_count=$(printf '%s\n' "$content_output" | grep -cE '^\s*\[?(33mINFO|INFO)' || true)
        if [[ "${info_count:-0}" -gt 0 ]]; then
            pass "Cold-path content lint clean (${info_count} info)"
        else
            pass "Cold-path content lint clean"
        fi
    else
        fail "audit --check-content reported drift (exit $content_exit)"
        printf '%s\n' "$content_output" | grep -E 'WARN|FAIL|\[non-actionable-remember\]|drift' | head -8 | details_pipe
    fi
else
    skip "Content Drift (dist/cli/cli.js not built)"
fi

# ── Doc/Code Drift ───────────────────────────────────────────────────
if [[ -f dist/cli/audit/check-goat-flow.js ]]; then
    section "Doc/Code Drift"

    # B.8a: Architecture count validation
    # Pipe through grep to strip any stray node diagnostics down to a bare number.
    build_count=$(node --input-type=module -e "const s=await import('./dist/cli/audit/check-goat-flow.js');const a=await import('./dist/cli/audit/check-agent-setup.js');console.log(s.SETUP_CHECKS.length+a.AGENT_CHECKS.length)" 2>/dev/null | grep -oE '^[0-9]+$' | tail -1 || echo "")
    quality_count=$(node --input-type=module -e "const q=await import('./dist/cli/audit/harness/index.js');console.log(q.HARNESS_CHECKS.length)" 2>/dev/null | grep -oE '^[0-9]+$' | tail -1 || echo "")

    setup_count=""
    if [[ -f .goat-flow/architecture.md ]] && [[ -n "$build_count" ]] && [[ -n "$quality_count" ]]; then
        if grep -Fq "${build_count} build" .goat-flow/architecture.md && grep -Fq "${quality_count} AI harness" .goat-flow/architecture.md; then
            pass "Architecture doc counts match code (build: ${build_count}, AI harness: ${quality_count})"
        else
            fail "Architecture doc check counts mismatch - expected ${build_count} build + ${quality_count} AI harness in .goat-flow/architecture.md"
        fi
        # B.8a2: Sub-breakdown validation (setup + agent)
        setup_count=$(node --input-type=module -e "const s=await import('./dist/cli/audit/check-goat-flow.js');console.log(s.SETUP_CHECKS.length)" 2>/dev/null | grep -oE '^[0-9]+$' | tail -1 || echo "")
        agent_count=$(node --input-type=module -e "const a=await import('./dist/cli/audit/check-agent-setup.js');console.log(a.AGENT_CHECKS.length)" 2>/dev/null | grep -oE '^[0-9]+$' | tail -1 || echo "")
        if [[ -n "$setup_count" ]] && [[ -n "$agent_count" ]]; then
            if grep -Fq "${setup_count} setup" .goat-flow/architecture.md && grep -Fq "${agent_count} agent" .goat-flow/architecture.md; then
                pass "Architecture doc sub-breakdown matches code (setup: ${setup_count}, agent: ${agent_count})"
            else
                fail "Architecture doc sub-breakdown mismatch - expected ${setup_count} setup + ${agent_count} agent in .goat-flow/architecture.md"
            fi
        fi
    else
        skip "Architecture count validation (dist/ not fully built or architecture.md missing)"
    fi

    # B.8a3: Downstream doc sub-breakdown drift
    # Architecture.md validated above. This catches stale sub-breakdown numbers
    # in other current-state docs that reference the same counts.
    # Excludes: CHANGELOG.md and workflow/manifest-snapshots/** (frozen per
    # release), .goat-flow/logs/ (historical), .goat-flow/scratchpad/ (WIP),
    # .goat-flow/learning-loop/lessons/ (narrative may include historical numbers).
    if [[ -n "$setup_count" ]]; then
        b8a3_ok=true
        for doc in CLAUDE.md AGENTS.md .goat-flow/code-map.md CONTRIBUTING.md; do
            [[ -f "$doc" ]] || continue
            stale=$(grep -oE '[0-9]+ setup' "$doc" 2>/dev/null | grep -Fv "${setup_count} setup" | head -1 || true)
            if [[ -n "$stale" ]]; then
                fail "Downstream doc sub-breakdown drift in ${doc}: found '${stale}' (expected '${setup_count} setup')"
                b8a3_ok=false
            fi
        done
        if $b8a3_ok; then
            pass "Downstream docs match setup sub-breakdown (${setup_count} setup)"
        fi
    fi

    # B.8b: Setup doc check ID validation
    if [[ -n "$build_count" ]]; then
        check_ids=$(node --input-type=module -e "const s=await import('./dist/cli/audit/check-goat-flow.js');const a=await import('./dist/cli/audit/check-agent-setup.js');[...s.SETUP_CHECKS,...a.AGENT_CHECKS].forEach(c=>console.log(c.id))" 2>/dev/null || echo "")
        b8b_ok=true
        while IFS= read -r ref; do
            id=$(echo "$ref" | grep -oP '[\w.-]+' | tail -1)
            if [[ -n "$id" ]] && ! echo "$check_ids" | grep -q "^${id}$"; then
                fail "Setup doc references non-existent check ID: $id"
                b8b_ok=false
            fi
        done < <(grep -ohP '\(check [\w.-]+\)' workflow/setup/*.md 2>/dev/null || true)
        if $b8b_ok; then
            pass "Setup doc check IDs are valid"
        fi
    fi

    # B.8d: code-map.md scripts list matches filesystem (catches drift like
    # code-map listing 3 scripts when scripts/ actually has 14).
    if [[ -f .goat-flow/code-map.md ]]; then
        listed_scripts=$(awk '
            /^## scripts\/ -- Shell scripts/ { in_section=1; next }
            in_section && /^## / { in_section=0 }
            in_section
        ' .goat-flow/code-map.md | grep -oE '[a-z][a-zA-Z0-9_.-]*\.(sh|mjs)' | sort -u || true)
        actual_scripts=$(find scripts/ -maxdepth 1 -type f \( -name '*.sh' -o -name '*.mjs' \) -printf '%f\n' | sort -u)
        if [[ "$listed_scripts" == "$actual_scripts" ]]; then
            pass "code-map.md scripts list matches scripts/ filesystem"
        else
            fail "code-map.md scripts list drifts from scripts/ filesystem"
            diff <(echo "$actual_scripts") <(echo "$listed_scripts") 2>&1 | head -10 | details_pipe
        fi
    fi
fi

# Check template-refs.ts doesn't reference missing workflow docs
if [[ -f src/cli/prompt/template-refs.ts ]]; then
    stale_refs=0
    while IFS= read -r template_path; do
        if [[ ! -f "$template_path" ]]; then
            fail "template-refs.ts references missing: $template_path"
            stale_refs=1
        fi
    done < <(grep -v '^\s*//' src/cli/prompt/template-refs.ts | grep -oE "workflow/[^'\"]*\.md" | sort -u)
    if [[ "$stale_refs" -eq 0 ]]; then
        pass "template-refs.ts: all referenced workflow docs exist"
    fi
fi

# B.8d: Dashboard concern key sync
if [[ -f dist/cli/audit/harness/index.js ]] && [[ -f src/dashboard/views/home.html ]]; then
    code_keys=$(node --input-type=module -e "
      const q=await import('./dist/cli/audit/harness/index.js');
      const keys=[...new Set(q.HARNESS_CHECKS.map(c=>c.concern))].sort();
      console.log(keys.join(','))
    " 2>/dev/null || echo "")
    html_keys=$(grep -oP "concernKeys:\s*\[([^\]]+)\]" src/dashboard/views/home.html \
        | head -1 | grep -oP "'[^']+'" | tr -d "'" | sort | paste -sd, 2>/dev/null || echo "")
    if [[ -n "$code_keys" ]] && [[ -n "$html_keys" ]]; then
        if [[ "$code_keys" == "$html_keys" ]]; then
            pass "Dashboard concern keys match harness checks"
        else
            fail "Dashboard concern keys mismatch: code=[$code_keys] html=[$html_keys]"
        fi
    else
        skip "Dashboard concern key sync (could not extract keys)"
    fi
fi

# B.8e: Dashboard view-name prose sync
if [[ -f workflow/manifest.json ]] && [[ -f .goat-flow/architecture.md ]]; then
    if dashboard_view_doc_check=$(node --input-type=module <<'NODE'
import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync("workflow/manifest.json", "utf8"));
const views = [...manifest.facts.dashboard_views].sort();
const expected = views.join(", ");
const architecture = readFileSync(".goat-flow/architecture.md", "utf8");
const requiredSnippets = [
  `views for ${expected}`,
  `Page views (${expected})`,
];
const missing = requiredSnippets.filter((snippet) => !architecture.includes(snippet));

if (missing.length > 0) {
  console.log(`Expected dashboard views: ${expected}`);
  for (const snippet of missing) {
    console.log(`Missing architecture snippet: ${snippet}`);
  }
  process.exit(1);
}
NODE
    ); then
        pass "Dashboard view names match manifest and architecture prose"
    else
        fail "Dashboard view names drift between manifest and architecture prose"
        printf '%s\n' "$dashboard_view_doc_check" | details_pipe
    fi
fi

# ── Skill Docs Sync ─────────────────────────────────────────────────
section "Skill Docs Sync"
if [[ -f workflow/skills/reference/README.md ]] && [[ -f .goat-flow/skill-docs/README.md ]]; then
    if diff -q workflow/skills/reference/README.md .goat-flow/skill-docs/README.md >/dev/null 2>&1; then
        pass "skill-docs README.md: template and installed copy match"
    else
        fail "skill-docs README.md: template (workflow/skills/reference/) and installed (.goat-flow/skill-docs/) differ"
    fi
else
    skip "skill-docs README.md sync (one or both files missing)"
fi
if [[ -f workflow/skills/reference/skill-preamble.md ]] && [[ -f .goat-flow/skill-docs/skill-preamble.md ]]; then
    if diff -q workflow/skills/reference/skill-preamble.md .goat-flow/skill-docs/skill-preamble.md >/dev/null 2>&1; then
        pass "skill-preamble.md: template and installed copy match"
    else
        fail "skill-preamble.md: template (workflow/skills/reference/) and installed (.goat-flow/skill-docs/) differ"
    fi
else
    skip "skill-preamble.md sync (one or both files missing)"
fi
if [[ -f workflow/skills/reference/skill-conventions.md ]] && [[ -f .goat-flow/skill-docs/skill-conventions.md ]]; then
    if diff -q workflow/skills/reference/skill-conventions.md .goat-flow/skill-docs/skill-conventions.md >/dev/null 2>&1; then
        pass "skill-conventions.md: template and installed copy match"
    else
        fail "skill-conventions.md: template (workflow/skills/reference/) and installed (.goat-flow/skill-docs/) differ"
    fi
else
    skip "skill-conventions.md sync (one or both files missing)"
fi
if [[ -f workflow/skills/playbooks/README.md ]] && [[ -f .goat-flow/skill-docs/playbooks/README.md ]]; then
    if diff -q workflow/skills/playbooks/README.md .goat-flow/skill-docs/playbooks/README.md >/dev/null 2>&1; then
        pass "skill-docs playbooks README.md: template and installed copy match"
    else
        fail "skill-docs playbooks README.md: template (workflow/skills/playbooks/) and installed (.goat-flow/skill-docs/playbooks/) differ"
    fi
else
    skip "skill-docs playbooks README.md sync (one or both files missing)"
fi
if [[ -f workflow/skills/playbooks/browser-use.md ]] && [[ -f .goat-flow/skill-docs/playbooks/browser-use.md ]]; then
    if diff -q workflow/skills/playbooks/browser-use.md .goat-flow/skill-docs/playbooks/browser-use.md >/dev/null 2>&1; then
        pass "browser-use.md: template and installed copy match"
    else
        fail "browser-use.md: template (workflow/skills/playbooks/) and installed (.goat-flow/skill-docs/playbooks/) differ"
    fi
else
    skip "browser-use.md sync (one or both files missing)"
fi
if [[ -f workflow/skills/playbooks/code-comments.md ]] && [[ -f .goat-flow/skill-docs/playbooks/code-comments.md ]]; then
    if diff -q workflow/skills/playbooks/code-comments.md .goat-flow/skill-docs/playbooks/code-comments.md >/dev/null 2>&1; then
        pass "code-comments.md: template and installed copy match"
    else
        fail "code-comments.md: template (workflow/skills/playbooks/) and installed (.goat-flow/skill-docs/playbooks/) differ"
    fi
else
    skip "code-comments.md sync (one or both files missing)"
fi
if [[ -f workflow/skills/playbooks/gruff-code-quality.md ]] && [[ -f .goat-flow/skill-docs/playbooks/gruff-code-quality.md ]]; then
    if diff -q workflow/skills/playbooks/gruff-code-quality.md .goat-flow/skill-docs/playbooks/gruff-code-quality.md >/dev/null 2>&1; then
        pass "gruff-code-quality.md: template and installed copy match"
    else
        fail "gruff-code-quality.md: template (workflow/skills/playbooks/) and installed (.goat-flow/skill-docs/playbooks/) differ"
    fi
else
    skip "gruff-code-quality.md sync (one or both files missing)"
fi
if [[ -f workflow/skills/playbooks/observability.md ]] && [[ -f .goat-flow/skill-docs/playbooks/observability.md ]]; then
    if diff -q workflow/skills/playbooks/observability.md .goat-flow/skill-docs/playbooks/observability.md >/dev/null 2>&1; then
        pass "observability.md: template and installed copy match"
    else
        fail "observability.md: template (workflow/skills/playbooks/) and installed (.goat-flow/skill-docs/playbooks/) differ"
    fi
else
    skip "observability.md sync (one or both files missing)"
fi
if [[ -f workflow/skills/playbooks/changelog.md ]] && [[ -f .goat-flow/skill-docs/playbooks/changelog.md ]]; then
    if diff -q workflow/skills/playbooks/changelog.md .goat-flow/skill-docs/playbooks/changelog.md >/dev/null 2>&1; then
        pass "changelog.md: template and installed copy match"
    else
        fail "changelog.md: template (workflow/skills/playbooks/) and installed (.goat-flow/skill-docs/playbooks/) differ"
    fi
else
    skip "changelog.md sync (one or both files missing)"
fi
if [[ -f workflow/skills/playbooks/page-capture.md ]] && [[ -f .goat-flow/skill-docs/playbooks/page-capture.md ]]; then
    if diff -q workflow/skills/playbooks/page-capture.md .goat-flow/skill-docs/playbooks/page-capture.md >/dev/null 2>&1; then
        pass "page-capture.md: template and installed copy match"
    else
        fail "page-capture.md: template (workflow/skills/playbooks/) and installed (.goat-flow/skill-docs/playbooks/) differ"
    fi
else
    skip "page-capture.md sync (one or both files missing)"
fi
if [[ -f workflow/skills/playbooks/release-notes.md ]] && [[ -f .goat-flow/skill-docs/playbooks/release-notes.md ]]; then
    if diff -q workflow/skills/playbooks/release-notes.md .goat-flow/skill-docs/playbooks/release-notes.md >/dev/null 2>&1; then
        pass "release-notes.md: template and installed copy match"
    else
        fail "release-notes.md: template (workflow/skills/playbooks/) and installed (.goat-flow/skill-docs/playbooks/) differ"
    fi
else
    skip "release-notes.md sync (one or both files missing)"
fi
if [[ -f workflow/skills/playbooks/skill-quality-testing.md ]] && [[ -f .goat-flow/skill-docs/skill-quality-testing/README.md ]]; then
    if diff -q workflow/skills/playbooks/skill-quality-testing.md .goat-flow/skill-docs/skill-quality-testing/README.md >/dev/null 2>&1; then
        pass "skill-quality-testing.md: template and installed copy match"
    else
        fail "skill-quality-testing.md: template (workflow/skills/playbooks/) and installed (.goat-flow/skill-docs/skill-quality-testing/) differ"
    fi
else
    skip "skill-quality-testing.md sync (one or both files missing)"
fi
for topical in tdd-iteration adversarial-framing deployment; do
    tpl="workflow/skills/playbooks/skill-quality-testing/${topical}.md"
    inst=".goat-flow/skill-docs/skill-quality-testing/${topical}.md"
    if [[ -f "$tpl" ]] && [[ -f "$inst" ]]; then
        if diff -q "$tpl" "$inst" >/dev/null 2>&1; then
            pass "skill-quality-testing/${topical}.md: template and installed copy match"
        else
            fail "skill-quality-testing/${topical}.md: template (workflow/skills/playbooks/skill-quality-testing/) and installed (.goat-flow/skill-docs/skill-quality-testing/) differ"
        fi
    else
        skip "skill-quality-testing/${topical}.md sync (one or both files missing)"
    fi
done

# ── Skill SKILL.md Parity ────────────────────────────────────────────
# Byte-exact diff (bash) for speed. For semantic comparison (frontmatter key
# reorder, trailing whitespace), see `goat-flow audit --check-drift` which
# adds YAML-aware normalisation. Both paths coexist for backward compatibility.
section "Skill SKILL.md Parity"
skill_parity_ok=true
while IFS= read -r skill_name; do
    while IFS= read -r relative_file; do
        [[ -n "$relative_file" ]] || continue
        template="workflow/skills/${skill_name}/${relative_file}"
        if [[ ! -f "$template" ]]; then
            fail "Skill template missing: ${template}"
            skill_parity_ok=false
            continue
        fi
        while IFS= read -r agent_dir; do
            # Skip manifest-declared agent roots that aren't installed in this
            # project. Single-agent consumer installs (only .claude/ or only
            # .agents/) would otherwise get "Skill file missing" failures for
            # every uninstalled agent tree - phantom drift.
            [[ -d "$agent_dir" ]] || continue
            installed="${agent_dir}/${skill_name}/${relative_file}"
            if [[ ! -f "$installed" ]]; then
                fail "Skill file missing: ${installed}"
                skill_parity_ok=false
                continue
            fi
            if ! diff -q "$template" "$installed" >/dev/null 2>&1; then
                fail "Skill file diverged: ${template} vs ${installed}"
                skill_parity_ok=false
            fi
        done < <(manifest_eval skill-roots)
    done < <(manifest_eval skill-files "$skill_name")
done < <(manifest_eval supported-skills)
if [[ "$skill_parity_ok" == true ]]; then
    pass "All installed skill files match workflow templates"
fi

# ── Path Integrity ───────────────────────────────────────────────────
section "Path Integrity"
if bash scripts/check-path-integrity.sh . >/dev/null 2>&1; then
    pass "All internal path references resolve"
else
    # Process substitution keeps the `while` body in the current shell, so
    # fail() correctly increments the global error counter (cmd | while
    # reads in a subshell and counter mutations get lost). The first
    # invocation captures stdout into a variable so set -e + pipefail
    # don't kill the script when the helper exits non-zero.
    pi_output=$(bash scripts/check-path-integrity.sh . 2>&1 || true)
    while IFS= read -r line; do
        fail "$line"
    done < <(printf '%s\n' "$pi_output" | grep "^FAIL:" || true)
fi

# ── Markdown Links ───────────────────────────────────────────────────
section "Markdown Links"
if bash scripts/check-markdown-links.sh . 2>&1 | grep -q "^All"; then
    link_count=$(bash scripts/check-markdown-links.sh . 2>&1 | grep -oP '\d+' | head -1)
    pass "All $link_count markdown links resolve"
else
    ml_output=$(bash scripts/check-markdown-links.sh . 2>&1 || true)
    while IFS= read -r line; do
        fail "$line"
    done < <(printf '%s\n' "$ml_output" | grep "^BROKEN" || true)
fi

# ── Package README Links ─────────────────────────────────────────────
section "Package README Links"
if [[ -f scripts/check-package-readme-links.mjs ]]; then
    package_link_output=$(node scripts/check-package-readme-links.mjs 2>&1) && package_link_exit=0 || package_link_exit=$?
    if [[ "$package_link_exit" -eq 0 ]]; then
        pass "$package_link_output"
    else
        fail "Package README link check failed (exit $package_link_exit)"
        echo "$package_link_output" | head -10 | details_pipe
    fi
else
    skip "Package README link check (scripts/check-package-readme-links.mjs missing)"
fi

# ── Summary ──────────────────────────────────────────────────────────
# render_report runs from the EXIT trap registered near the top.
if [[ "$errors" -gt 0 ]]; then
    exit 1
fi
exit 0

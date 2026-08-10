#!/usr/bin/env bash

# post-turn-safety.sh
# goat-flow-hook-version: 1.15.1
#
# Purpose:
#   Universal Stop-event safety guard for supported agents. This hook checks
#   changed text content for built-in safety hazards that goat-flow can evaluate
#   without knowing the target project's language stack or validation commands.
#
# Runtime contract:
#   This is not project validation. It does not run tests, builds, linters, or
#   formatters, and it must not claim that the project passed validation. It
#   blocks only high-confidence safety hazards in changed content.
#
# Exit codes:
#   0  clean scan, no findings
#   1  reserved for host-level hook unavailability
#   2  findings blocked, or the scan could not complete
#
# Bash 4+ performance architecture (Windows Git Bash ships fork costs 10-40x
# Linux, so its optimized scan must not spawn per line or per file):
#   1. Path sets come from the same `git diff --name-only -z` / `git ls-files -z`
#      plumbing as before, but content is read through one batched
#      `git diff --unified=0` per pass instead of one diff process per path.
#   2. A grep pre-filter (a provable superset of every scan_line trigger, see
#      the *_RE definitions) selects candidate lines; only matched lines reach
#      the per-line bash analysis.
#   3. Its string helpers are pure bash (no sed/tr/subshell forks).
#   4. External commands are chunked to stay inside Windows' command-line
#      length limit; total process count is O(passes), not O(files or lines).
# The Bash 3 compatibility path favors coverage on stock macOS and remains
# bounded by the same wall-clock, file-size, and output limits.

set -uo pipefail
shopt -s extglob

# Bash 3.2 ships with supported macOS versions. Keep this compatibility path
# free of associative arrays, mapfile, and Bash-4 parameter expansions. The
# force flag executes this exact path under newer Bash during integration tests.
fallback_findings=0
fallback_reported="
"
fallback_conflict_path=""
fallback_conflict_state=0
fallback_bail=0
fallback_incomplete_reason=""
fallback_incomplete_kind=""
fallback_coverage_gap=0
fallback_workdir=""
fallback_temp_sequence=0
fallback_max_seconds="${GOAT_FLOW_POST_TURN_SAFETY_MAX_SECONDS:-60}"
fallback_max_bytes="${GOAT_FLOW_POST_TURN_SAFETY_MAX_BYTES:-1048576}"
fallback_max_findings="${GOAT_FLOW_POST_TURN_SAFETY_MAX_FINDINGS:-20}"
post_turn_action="scan"
post_turn_hook_version="1.15.1"
post_turn_result_schema="goat-flow.hook-result.v1"
post_turn_migrated_result_mode=0
post_turn_result_records_path=""
post_turn_result_record_error=0
post_turn_result_detail=""
post_turn_result_reason_override=""
bounded_reentry_ended=0
stop_payload_present=0
stop_session_fingerprint=""
stop_hook_active=0
stop_payload_error=""

# A managed launcher supplies every identity field needed for one neutral result.
# Use this mode when provider feedback must come from the final shared adapter.
if [ "${GOAT_FLOW_HOOK_RESULT_PROTOCOL:-}" = "$post_turn_result_schema" ] && \
  [ -n "${GOAT_FLOW_HOOK_PROVIDER:-}" ] && \
  [ -n "${GOAT_FLOW_HOOK_EVENT:-}" ] && \
  [ -n "${GOAT_FLOW_HOOK_PROVIDER_MODE:-}" ] && \
  [ -n "${GOAT_FLOW_HOOK_ADAPTER_VERSION:-}" ]; then
  post_turn_migrated_result_mode=1
fi

# Store one finding as NUL-separated fields so unusual user filenames remain valid JSON later.
# Use while scanning; the final emitter turns these records into bounded model feedback.
record_post_turn_result_finding() {
  local finding_code="$1"
  local finding_message="$2"
  local finding_target="$3"

  # Legacy users already receive the established stderr and exit-code result.
  if [ "$post_turn_migrated_result_mode" -eq 0 ]; then
    return 0
  fi
  # A missing records path means scanner setup failed before details could be retained.
  if [ -z "$post_turn_result_records_path" ]; then
    post_turn_result_record_error=1
    return 0
  fi
  # For example, a user may lose write access to the temporary scan directory mid-turn.
  if ! printf '%s\0%s\0%s\0' "$finding_code" "$finding_message" "$finding_target" >>"$post_turn_result_records_path"; then
    post_turn_result_record_error=1
  fi
  return 0
}

# Emit one provider-neutral Stop envelope with truthful coverage and bounded findings.
# Use after either scanner finishes so the shared adapter can block, allow, or explain the turn.
emit_post_turn_hook_result() {
  local scanner_implementation="$1"
  local scanner_status="$2"
  local observed_finding_count=0
  local scan_became_incomplete=0
  local scan_has_coverage_gap=0
  local result_outcome="incomplete"
  local result_reason_code="coverage-incomplete"
  local result_coverage_status="none"
  local attempted_scan_units=1
  local completed_scan_units=0
  local skipped_scan_units=1
  local result_detail="$post_turn_result_detail"
  local result_duration_ms=$((SECONDS * 1000))

  case "$scanner_implementation" in
    fallback)
      observed_finding_count="$fallback_findings"
      scan_became_incomplete="$fallback_bail"
      scan_has_coverage_gap="$fallback_coverage_gap"
      result_detail="${fallback_incomplete_reason:-$result_detail}"
      ;;
    native)
      observed_finding_count="$findings"
      scan_became_incomplete="$BAIL"
      scan_has_coverage_gap="$COVERAGE_GAP"
      result_detail="${INCOMPLETE_REASON:-$result_detail}"
      ;;
  esac

  # A record-write failure makes detailed provider feedback unavailable even if scanning continued.
  if [ "$post_turn_result_record_error" -ne 0 ]; then
    result_outcome="unavailable"
    result_reason_code="hook-unavailable"
    result_detail="Hook result details could not be retained for provider delivery"
  # One verified repeat ends the provider cycle but remains explicitly incomplete for the user.
  elif [ "$bounded_reentry_ended" -ne 0 ]; then
    result_outcome="incomplete"
    result_reason_code="bounded-reentry-ended"
    result_detail="The unchanged infrastructure failure ended its bounded provider re-entry; no clean scan was recorded"
  # Actionable findings block the turn, while any concurrent scan gap remains visible in coverage.
  elif [ "$observed_finding_count" -gt 0 ]; then
    result_outcome="block"
    result_reason_code="policy-blocked"
    # A finding does not erase skipped content when the same scan also became incomplete.
    if [ "$scan_became_incomplete" -eq 0 ] && [ "$scan_has_coverage_gap" -eq 0 ]; then
      result_coverage_status="complete"
      completed_scan_units=1
      skipped_scan_units=0
    else
      result_coverage_status="partial"
    fi
  # Status zero with no terminal re-entry means the complete safety scan was clean.
  elif [ "$scanner_status" -eq 0 ]; then
    result_outcome="pass"
    result_reason_code="completed-clean"
    result_coverage_status="complete"
    completed_scan_units=1
    skipped_scan_units=0
  fi

  # A specific input failure explains why the user's Stop payload could not be scanned.
  if [ -n "$post_turn_result_reason_override" ]; then
    result_reason_code="$post_turn_result_reason_override"
  fi
  # Empty incomplete detail still needs one practical recovery message in provider feedback.
  if [ -z "$result_detail" ] && [ "$result_outcome" != "pass" ]; then
    result_detail="The changed-content safety scan did not complete"
  fi

  # shellcheck disable=SC2016 # Literal JavaScript prevents shell expansion of user feedback.
  POST_TURN_RESULT_RECORDS_PATH="$post_turn_result_records_path" \
    POST_TURN_RESULT_OUTCOME="$result_outcome" \
    POST_TURN_RESULT_REASON_CODE="$result_reason_code" \
    POST_TURN_RESULT_COVERAGE_STATUS="$result_coverage_status" \
    POST_TURN_RESULT_ATTEMPTED_UNITS="$attempted_scan_units" \
    POST_TURN_RESULT_COMPLETED_UNITS="$completed_scan_units" \
    POST_TURN_RESULT_SKIPPED_UNITS="$skipped_scan_units" \
    POST_TURN_RESULT_DETAIL="$result_detail" \
    POST_TURN_RESULT_DURATION_MS="$result_duration_ms" \
    node -e '
const { existsSync, readFileSync } = require("node:fs");
const recordsPath = process.env.POST_TURN_RESULT_RECORDS_PATH ?? "";
let resultOutcome = process.env.POST_TURN_RESULT_OUTCOME;
let resultReasonCode = process.env.POST_TURN_RESULT_REASON_CODE;
let resultDetail = process.env.POST_TURN_RESULT_DETAIL ?? "";
let userVisibleFindings = [];
try {
  // A records file exists only when the scanner found user-facing detail to preserve.
  if (recordsPath.length > 0 && existsSync(recordsPath)) {
    const recordFields = readFileSync(recordsPath).toString("utf8").split("\0");
    // Each complete three-field record becomes one provider-safe finding in scan order.
    for (let fieldIndex = 0; fieldIndex + 2 < recordFields.length && userVisibleFindings.length < 20; fieldIndex += 3) {
      userVisibleFindings.push({
        code: recordFields[fieldIndex],
        message: recordFields[fieldIndex + 1],
        target: recordFields[fieldIndex + 2],
      });
    }
  }
} catch {
  // For example, cleanup software may remove the temporary records file before Stop finishes.
  resultOutcome = "unavailable";
  resultReasonCode = "hook-unavailable";
  resultDetail = "Hook result details could not be read for provider delivery";
  userVisibleFindings = [];
}
// A non-pass result with no recorded detail still tells the active model what stopped the user flow.
if (resultOutcome !== "pass" && userVisibleFindings.length === 0) {
  userVisibleFindings.push({
    code: resultReasonCode,
    message: resultDetail,
    target: "project",
  });
}
const providerIdentifier = process.env.GOAT_FLOW_HOOK_PROVIDER ?? "claude";
const hookEvent = process.env.GOAT_FLOW_HOOK_EVENT ?? "turn-stop";
const resultEnvelope = {
  schema: "goat-flow.hook-result.v1",
  hookId: "post-turn-safety",
  event: hookEvent,
  outcome: resultOutcome,
  coverage: {
    status: process.env.POST_TURN_RESULT_COVERAGE_STATUS,
    attemptedUnits: Number(process.env.POST_TURN_RESULT_ATTEMPTED_UNITS),
    completedUnits: Number(process.env.POST_TURN_RESULT_COMPLETED_UNITS),
    skippedUnits: Number(process.env.POST_TURN_RESULT_SKIPPED_UNITS),
  },
  reasonCode: resultReasonCode,
  findings: userVisibleFindings,
  execution: {
    hookVersion: process.env.POST_TURN_HOOK_VERSION,
    provider: providerIdentifier,
    providerMode: process.env.GOAT_FLOW_HOOK_PROVIDER_MODE ?? "managed",
    adapterName: `${providerIdentifier}-${hookEvent}`,
    adapterVersion: process.env.GOAT_FLOW_HOOK_ADAPTER_VERSION ?? "1",
    durationMs: Number(process.env.POST_TURN_RESULT_DURATION_MS),
  },
};
process.stdout.write(`${JSON.stringify(resultEnvelope)}\n`);
'
}

# Preserve legacy exit codes or replace them with one completed neutral-envelope delivery.
# Use at scanner dispatch so direct terminal users and managed coding agents keep distinct contracts.
finish_post_turn_scan() {
  local scanner_implementation="$1"
  local scanner_function="$2"
  local scanner_status
  shift 2

  "$scanner_function" "$@"
  scanner_status=$?
  # Managed hooks return zero after emitting the real outcome inside the validated envelope.
  if [ "$post_turn_migrated_result_mode" -ne 0 ]; then
    POST_TURN_HOOK_VERSION="$post_turn_hook_version" emit_post_turn_hook_result "$scanner_implementation" "$scanner_status"
    return $?
  fi
  return "$scanner_status"
}

# Show the two intentional user entry points so a mistyped option never scans a project.
print_post_turn_usage() {
  printf 'Usage: post-turn-safety.sh [--self-test]\n' >&2
}

# A user can explicitly request the installed check; every other option is a mistake.
if [ "$#" -eq 1 ] && [ "$1" = "--self-test" ]; then
  post_turn_action="self-test"
# Multiple or unknown options must not accidentally start a repository scan.
elif [ "$#" -ne 0 ]; then
  print_post_turn_usage
  exit 2
fi

# Read and validate the coding agent's bounded Stop context before scanning user changes.
# Direct terminal use has closed stdin and continues without provider re-entry behavior.
read_stop_context() {
  local parsed_stop_context
  local stop_payload_json=""
  local stop_payload_line=""

  # Provider JSON may span lines, so retain each line until EOF or the safety cap.
  while IFS= read -r stop_payload_line || [ -n "$stop_payload_line" ]; do
    stop_payload_json="${stop_payload_json}${stop_payload_json:+$'\n'}${stop_payload_line}"
    # Oversized provider input cannot be trusted as the user's Stop event.
    if [ "${#stop_payload_json}" -gt 65536 ]; then
      stop_payload_error="payload exceeds 65536 bytes"
      return 1
    fi
  done

  # Empty stdin means a user ran the hook directly rather than an agent ending a turn.
  if [ -z "$stop_payload_json" ]; then
    return 0
  fi
  stop_payload_present=1

  # JSON validation needs the shipped Node runtime; without it the Stop result is incomplete.
  if ! command -v node >/dev/null 2>&1; then
    stop_payload_error="JSON parser unavailable"
    return 1
  fi
  # A malformed or wrong-event payload means the coding agent cannot safely finish the turn.
  if ! parsed_stop_context="$(node -e '
const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
try {
  const payload = JSON.parse(readFileSync(0, "utf8"));
  // An empty or oversized session cannot safely key the active user conversation.
  if (typeof payload.session_id !== "string" || payload.session_id.length < 1 || payload.session_id.length > 512) throw new Error("session");
  // The provider must say whether this Stop follows a previous hook block.
  if (typeof payload.stop_hook_active !== "boolean") throw new Error("active");
  // Another lifecycle event must never be mistaken for the end of the user turn.
  if (payload.hook_event_name !== undefined && payload.hook_event_name !== "Stop") throw new Error("event");
  const sessionFingerprint = createHash("sha256").update(payload.session_id).digest("hex");
  process.stdout.write(sessionFingerprint + "\t" + (payload.stop_hook_active ? "1" : "0"));
} catch {
  // A provider can truncate JSON while ending the active turn, so fail closed.
  process.exit(2);
}
' <<<"$stop_payload_json")"; then
    stop_payload_error="JSON or required Stop fields are invalid"
    return 1
  fi

  # Only one hash and one boolean may influence the user's continuation decision.
  if [[ ! "$parsed_stop_context" =~ ^([a-f0-9]{64})$'\t'([01])$ ]]; then
    stop_payload_error="parsed Stop fields are invalid"
    return 1
  fi
  stop_session_fingerprint="${BASH_REMATCH[1]}"
  stop_hook_active="${BASH_REMATCH[2]}"
  return 0
}

# Resolve the one ignored owner-local state file used to bound a repeated Stop failure.
# The path contains hashes only, so it never stores the user's session ID or changed content.
set_stop_state_paths() {
  stop_state_directory="$1/.goat-flow/scratchpad"
  stop_state_path="$stop_state_directory/post-turn-safety-reentry-v1.state"
  stop_state_temp_path="$stop_state_path.tmp"
}

# Read a portable owner-only mode so unsafe state can never release the user's turn.
read_stop_state_mode() {
  # Linux users have GNU stat, whose mode flag is tried first.
  if stop_state_mode="$(stat -c '%a' "$1" 2>/dev/null)"; then
    return 0
  fi
  # macOS users have BSD stat, whose mode flag differs from GNU stat.
  if stop_state_mode="$(stat -f '%Lp' "$1" 2>/dev/null)"; then
    return 0
  fi
  stop_state_mode=""
  return 1
}

# Remove only a regular state file owned by the current user after a clean or changed result.
clear_stop_reentry_state() {
  local repository_root="$1"

  # A direct user run has no provider cycle to clear.
  if [ "$stop_payload_present" -eq 0 ]; then
    return 0
  fi
  set_stop_state_paths "$repository_root"
  # No prior state is already the clean state the user needs.
  if [ ! -e "$stop_state_path" ] && [ ! -L "$stop_state_path" ]; then
    return 0
  fi
  # Symlinks, directories, and foreign files are never touched by the hook.
  if [ -L "$stop_state_path" ] || [ ! -f "$stop_state_path" ] || [ ! -O "$stop_state_path" ]; then
    return 1
  fi
  rm -f -- "$stop_state_path"
}

# Hash one non-secret failure description for exact repeated-failure comparison.
hash_stop_failure() {
  # Hashing failure keeps the user blocked because exact re-entry cannot be proven.
  if ! stop_failure_fingerprint="$(node -e '
const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
process.stdout.write(createHash("sha256").update(readFileSync(0)).digest("hex"));
' <<<"$1")"; then
    stop_failure_fingerprint=""
    return 1
  fi
  [[ "$stop_failure_fingerprint" =~ ^[a-f0-9]{64}$ ]]
}

# Persist only hashed provider and failure identities in one owner-only atomic record.
write_stop_reentry_state() {
  local repository_root="$1"
  local failure_fingerprint="$2"

  set_stop_state_paths "$repository_root"
  # State must stay inside real project directories rather than a redirected symlink.
  if [ -L "$repository_root/.goat-flow" ] || [ -L "$stop_state_directory" ]; then
    return 1
  fi
  # Create the private state directory only inside the verified project root.
  if ! (umask 077 && mkdir -p "$stop_state_directory"); then
    return 1
  fi
  # Existing state may be replaced only when it is a regular file owned by this user.
  if { [ -e "$stop_state_path" ] || [ -L "$stop_state_path" ]; } && \
    { [ -L "$stop_state_path" ] || [ ! -f "$stop_state_path" ] || [ ! -O "$stop_state_path" ]; }; then
    return 1
  fi
  # A prior interrupted write is removed only when it is the hook's own regular file.
  if [ -e "$stop_state_temp_path" ] || [ -L "$stop_state_temp_path" ]; then
    # An unsafe temporary target could redirect or overwrite data the user did not select.
    if [ -L "$stop_state_temp_path" ] || [ ! -f "$stop_state_temp_path" ] || [ ! -O "$stop_state_temp_path" ]; then
      return 1
    fi
    rm -f -- "$stop_state_temp_path" || return 1
  fi
  # Exclusive creation prevents the temporary record from following a concurrent replacement.
  if ! (umask 077 && set -C && printf 'v1 %s %s\n' "$stop_session_fingerprint" "$failure_fingerprint" >"$stop_state_temp_path"); then
    return 1
  fi
  # Mode and atomic replacement must both finish before state can affect a user turn.
  if ! chmod 600 "$stop_state_temp_path" || ! mv -f "$stop_state_temp_path" "$stop_state_path"; then
    rm -f -- "$stop_state_temp_path"
    return 1
  fi
  return 0
}

# Return success only when owner-only state matches this session and infrastructure failure.
stop_reentry_state_matches() {
  local repository_root="$1"
  local expected_failure_fingerprint="$2"
  local state_version=""
  local saved_session_fingerprint=""
  local saved_failure_fingerprint=""
  local unexpected_state_text=""

  set_stop_state_paths "$repository_root"
  # Missing or unsafe state cannot authorize the coding agent to end the turn.
  if [ ! -f "$stop_state_path" ] || [ -L "$stop_state_path" ] || [ ! -O "$stop_state_path" ]; then
    return 1
  fi
  read_stop_state_mode "$stop_state_path" || return 1
  # Group or public access would expose or permit tampering with the continuation record.
  if [ "$stop_state_mode" != "600" ]; then
    return 1
  fi
  IFS=' ' read -r state_version saved_session_fingerprint saved_failure_fingerprint unexpected_state_text <"$stop_state_path" || return 1
  # Extra, empty, or malformed fields mean the state cannot represent this exact user cycle.
  if [ "$state_version" != "v1" ] || [ -n "$unexpected_state_text" ] || \
    [[ ! "$saved_session_fingerprint" =~ ^[a-f0-9]{64}$ ]] || \
    [[ ! "$saved_failure_fingerprint" =~ ^[a-f0-9]{64}$ ]]; then
    return 1
  fi
  [ "$saved_session_fingerprint" = "$stop_session_fingerprint" ] && \
    [ "$saved_failure_fingerprint" = "$expected_failure_fingerprint" ]
}

# Block the first infrastructure failure, then end one exact unchanged provider re-entry loudly.
# Findings, coverage gaps, budgets, malformed input, and changed failures use other blocking paths.
finish_infrastructure_failure() {
  local repository_root="$1"
  local failure_identity="$2"

  # Direct runs and invalid provider context have no safe identity for re-entry handling.
  if [ "$stop_payload_present" -eq 0 ] || [ -z "$stop_session_fingerprint" ]; then
    return 2
  fi
  # A missing fingerprint cannot distinguish this failure from a changed user-visible fault.
  if ! hash_stop_failure "$failure_identity"; then
    printf 'post-turn-safety: repeated-Stop state unavailable; keeping the turn blocked.\n' >&2
    return 2
  fi
  # One exact active replay means the agent cannot repair this infrastructure failure in-turn.
  if [ "$stop_hook_active" -eq 1 ] && stop_reentry_state_matches "$repository_root" "$stop_failure_fingerprint"; then
    bounded_reentry_ended=1
    clear_stop_reentry_state "$repository_root" >/dev/null 2>&1
    printf 'post-turn-safety: ending repeated Stop after unchanged infrastructure failure; no clean scan was recorded.\n' >&2
    return 0
  fi
  # The first or changed failure must persist exact state and keep the user turn blocked.
  if ! write_stop_reentry_state "$repository_root" "$stop_failure_fingerprint"; then
    printf 'post-turn-safety: repeated-Stop state unavailable; keeping the turn blocked.\n' >&2
  fi
  return 2
}

# Detector shapes are shared by the Bash 3 compatibility and optimized paths.
# Keep thresholds and placeholder decisions in this Bash-3-safe block
# so either execution path cannot silently define a different security policy.
AWS_TOKEN_RE='(AKIA|ASIA)[A-Z0-9]{16}'
GITHUB_LEGACY_TOKEN_RE='gh[pousr]_[A-Za-z0-9_]{30,}'
GITHUB_FINE_GRAINED_TOKEN_RE='github_pat_[A-Za-z0-9_]{20,}'
NPM_TOKEN_RE='npm_[A-Za-z0-9]{36,}'
SLACK_TOKEN_RE='xox[baprs]-[A-Za-z0-9-]{20,}'
API_TOKEN_RE='sk-[A-Za-z0-9][A-Za-z0-9_-]{31,}'
PRIVATE_KEY_RE='-----BEGIN[[:space:]](RSA[[:space:]]|DSA[[:space:]]|EC[[:space:]]|OPENSSH[[:space:]])?PRIVATE[[:space:]]KEY-----'
PLACEHOLDER_ALL_X_RE='^(gh[pousr]_|github_pat_|npm_|sk-)?x+$'
PLACEHOLDER_MARKER_RE='(^|[_-])(example|placeholder|changeme|change-me|change_me|dummy|fake|sample|test|redacted|xxxx|your-token|your_token|your-key|your_key|your-api-key|your_api_key|not-a-secret)([_-]|$)'

# Recognize varied literal values so ordinary words do not interrupt the user's turn.
has_credential_entropy() {
  local value="$1"
  case "$value" in
    gh[pousr]_* | github_pat_* | npm_* | sk-* | xox[baprs]-* | AKIA* | ASIA*)
      return 0
      ;;
  esac
  [[ "$value" =~ [0-9] ]] || return 1
  # Mixed letter case usually means the user entered an opaque generated value.
  if [[ "$value" =~ [[:lower:]] ]] && [[ "$value" =~ [[:upper:]] ]]; then
    return 0
  fi
  # Credential punctuation distinguishes generated values from ordinary UI words.
  if [[ "$value" =~ [._+/=~-] ]]; then
    return 0
  fi
  # Long hexadecimal text can represent a real key even without mixed case.
  if [ "${#value}" -ge 20 ] && [[ "$value" =~ ^[a-f0-9]+$ ]]; then
    return 0
  fi
  return 1
}

# Keep environment references and UI template expressions out of literal-secret warnings.
is_reference_or_interpolation() {
  local value="$1"
  case "$value" in
    *%env\(* | *%ENV\(*) return 0 ;;
    *\$\{* | *\$\(*) return 0 ;;
    *\{\{* | *\}\}* | *\{%* | *%\}*) return 0 ;;
    *\<%* | *%\>*) return 0 ;;
  esac
  [[ "$value" =~ ^%[^%[:space:]]+%$ ]] && return 0
  return 1
}

# Preserve the first compatibility failure that explains why the user's scan stopped.
fallback_mark_incomplete() {
  # Later failures must not replace the first actionable explanation shown to the user.
  if [ -z "$fallback_incomplete_reason" ]; then
    fallback_incomplete_kind="command"
    fallback_incomplete_reason="$1"
  fi
  fallback_bail=1
}

# Record one changed path the compatibility scanner cannot safely inspect for the user.
fallback_mark_coverage_gap() {
  fallback_coverage_gap=1
  record_post_turn_result_finding "coverage-gap" "$2" "$1"
  printf 'post-turn-safety: scan incomplete (%s in %s).\n' "$2" "$1" >&2
}

# Stop compatibility work when a prior failure or the user's time limit makes it incomplete.
fallback_budget_check() {
  # A prior failure means no later compatibility work can restore a clean result.
  if [ "$fallback_bail" -ne 0 ]; then
    return 1
  fi
  # Reaching the configured limit leaves some user changes unverified.
  if [ "$SECONDS" -ge "$fallback_max_seconds" ]; then
    # A time limit leaves user content unscanned, so it cannot use infrastructure re-entry.
    if [ -z "$fallback_incomplete_reason" ]; then
      fallback_incomplete_kind="budget"
      fallback_incomplete_reason="budget ${fallback_max_seconds}s exceeded"
    fi
    fallback_bail=1
    return 1
  fi
  return 0
}

# Reserve one deterministic scratch path for the next compatibility scan result.
fallback_next_temp_path() {
  fallback_temp_sequence=$((fallback_temp_sequence + 1))
  FALLBACK_TEMP_PATH="$fallback_workdir/$1-$fallback_temp_sequence"
}

# Lowercase user text through the portable command available to stock macOS Bash.
fallback_lower() {
  # A failed normalizer makes the compatibility classification incomplete.
  if ! FALLBACK_LOWER=$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]'); then
    fallback_mark_incomplete "text normalization command failed"
    FALLBACK_LOWER=""
    return 1
  fi
  return 0
}

# Trim surrounding whitespace before the compatibility scanner classifies user text.
fallback_trim() {
  FALLBACK_TRIMMED="${1##+([[:space:]])}"
  FALLBACK_TRIMMED="${FALLBACK_TRIMMED%%+([[:space:]])}"
}

# Normalize a credential label so equivalent UI/config naming styles get one decision.
fallback_normalize_key() {
  local raw="$1"
  local first=""
  local second=""
  local c
  local i
  local n

  n=${#raw}
  i=0
  # Walk the original label so camelCase boundaries become visible to the user-facing classifier.
  while [ "$i" -lt "$n" ]; do
    c="${raw:$i:1}"
    # A lowercase-to-uppercase boundary starts a new credential-label word.
    if [ "$i" -gt 0 ] && [[ "${raw:$((i - 1)):1}" == [[:lower:][:digit:]] && "$c" == [[:upper:]] ]]; then
      first="${first}_"
    fi
    first="${first}${c}"
    i=$((i + 1))
  done

  n=${#first}
  i=0
  # Walk the intermediate label so acronym endings also become separate words.
  while [ "$i" -lt "$n" ]; do
    c="${first:$i:1}"
    # The last capital before lowercase text starts the next readable word.
    if [ "$i" -gt 0 ] && [ "$((i + 1))" -lt "$n" ] && [[ "${first:$((i - 1)):1}" == [[:upper:]] && "$c" == [[:upper:]] && "${first:$((i + 1)):1}" == [[:lower:]] ]]; then
      second="${second}_"
    fi
    second="${second}${c}"
    i=$((i + 1))
  done

  fallback_lower "$second" || return 1
  FALLBACK_NORMALIZED_KEY="${FALLBACK_LOWER//-/_}"
}

# Emit one compatibility finding per family and path without repeating user guidance.
fallback_report() {
  local path="$1"
  local family="$2"
  local key="
$path|$family
"
  case "$fallback_reported" in
    *"$key"*) return 0 ;;
  esac
  fallback_reported="${fallback_reported}$path|$family
"
  fallback_findings=$((fallback_findings + 1))
  record_post_turn_result_finding "safety-hazard" "Blocked $family in changed content" "$path"
  # The output cap keeps a large edit readable while the final count stays honest.
  if [ "$fallback_findings" -le "$fallback_max_findings" ]; then
    printf 'post-turn-safety: %s in %s (Bash 3 compatibility scan).\n' "$family" "$path" >&2
  fi
}

# Keep documented placeholder values usable in examples and setup screens.
fallback_is_placeholder() {
  local value
  # Normalization failure is already incomplete, so do not add a speculative secret finding.
  if ! fallback_lower "$1"; then
    return 0
  fi
  value="$FALLBACK_LOWER"
  case "$value" in
    "" | akiaiosfodnn7example | asiaiosfodnn7example)
      return 0
      ;;
  esac
  [[ "$value" =~ $PLACEHOLDER_ALL_X_RE ]] && return 0
  [[ "$value" =~ $PLACEHOLDER_MARKER_RE ]]
}

# Decide whether a quoted value remains one literal credential the user can rotate.
# Expression suffixes stay out of warnings so ordinary code does not look like a leak.
# $1 is post-quote text; empty means ended. Returns 0 for a literal, 1 for an expression.
suffix_ends_assignment() {
  local after_terminator
  case "$1" in
    # Nothing or a comment follows, so the quoted value is the whole assignment.
    "" | \#*) return 0 ;;
    # A bare statement terminator, as in `export TOKEN="abc123";`.
    ";") return 0 ;;
    ";"*)
      fallback_trim "${1#;}"
      after_terminator="$FALLBACK_TRIMMED"
      # Only spacing or a trailing comment after the semicolon, still one value.
      case "$after_terminator" in
        "" | \#*) return 0 ;;
      esac
      return 1
      ;;
  esac
  return 1
}

# Admit only config-shaped files to compatibility credential-assignment checks.
fallback_is_env_assignment_file() {
  local basename
  local lower_path
  fallback_lower "$1" || return 1
  lower_path="$FALLBACK_LOWER"
  basename="${lower_path##*/}"
  case "$basename" in
    .env* | *.env | *.env.* | dockerfile | dockerfile.* | *.dockerfile | *.sh | *.bash | *.zsh | *.ksh | *.yaml | *.yml | *.ini | *.toml | *.properties | *.conf | *.cfg)
      return 0
      ;;
  esac
  return 1
}

# Identify Dockerfile paths before applying portable container assignment grammar.
fallback_is_dockerfile_path() {
  local basename
  local lower_path
  fallback_lower "$1" || return 1
  lower_path="$FALLBACK_LOWER"
  basename="${lower_path##*/}"
  case "$basename" in
    dockerfile | dockerfile.* | *.dockerfile)
      return 0
      ;;
  esac
  return 1
}

# Extracts the literal a stock macOS user placed in a credential assignment.
# Sets FALLBACK_LITERAL_VALUE on success; references and expressions stay allowed.
fallback_literal_assignment_value() {
  local dotted_identifier_re
  local literal_value
  local operator_expression_re
  local operator_left_identifier
  local raw_assignment_value
  local text_after_closing_quote
  local text_after_opening_quote
  local unquoted_assignment_value
  local value_first_segment
  local value_first_segment_lower

  FALLBACK_LITERAL_VALUE=""
  fallback_trim "$1"
  raw_assignment_value="$FALLBACK_TRIMMED"
  # Keep language-formatted strings in the allowed expression path.
  case "$raw_assignment_value" in
    [fF]\"* | [fF]\'* | [fF][rR]\"* | [fF][rR]\'* | [rR][fF]\"* | [rR][fF]\'*)
      return 1
      ;;
  esac

  # Parse quoted values so a trailing user comment cannot hide a credential.
  case "$raw_assignment_value" in
    \"*)
      text_after_opening_quote="${raw_assignment_value#?}"
      # An unclosed quote is not a literal the scanner can classify safely.
      case "$text_after_opening_quote" in *\"*) ;; *) return 1 ;; esac
      literal_value="${text_after_opening_quote%%\"*}"
      # Whitespace or interpolation means the user entered an expression.
      case "$literal_value" in
        *[[:space:]]* | *'$'*) return 1 ;;
      esac
      # References stay allowed because they do not embed a credential.
      is_reference_or_interpolation "$literal_value" && return 1
      text_after_closing_quote="${text_after_opening_quote#*\"}"
      fallback_trim "$text_after_closing_quote"
      text_after_closing_quote="$FALLBACK_TRIMMED"
      # Only an assignment-ending suffix may follow the closing quote.
      suffix_ends_assignment "$text_after_closing_quote" || return 1
      FALLBACK_LITERAL_VALUE="$literal_value"
      return 0
      ;;
    \'*)
      text_after_opening_quote="${raw_assignment_value#?}"
      # An unclosed quote is not a literal the scanner can classify safely.
      case "$text_after_opening_quote" in *\'*) ;; *) return 1 ;; esac
      literal_value="${text_after_opening_quote%%\'*}"
      # Whitespace means the user entered more than one literal token.
      case "$literal_value" in *[[:space:]]*) return 1 ;; esac
      # References stay allowed because they do not embed a credential.
      is_reference_or_interpolation "$literal_value" && return 1
      text_after_closing_quote="${text_after_opening_quote#*\'}"
      fallback_trim "$text_after_closing_quote"
      text_after_closing_quote="$FALLBACK_TRIMMED"
      # Only an assignment-ending suffix may follow the closing quote.
      suffix_ends_assignment "$text_after_closing_quote" || return 1
      FALLBACK_LITERAL_VALUE="$literal_value"
      return 0
      ;;
  esac

  # Remove a trailing user comment before classifying an unquoted value.
  unquoted_assignment_value="${raw_assignment_value%%#*}"
  fallback_trim "$unquoted_assignment_value"
  unquoted_assignment_value="$FALLBACK_TRIMMED"
  # An empty value gives the user no credential to rotate.
  [ -n "$unquoted_assignment_value" ] || return 1
  # Expression punctuation keeps ordinary code out of credential warnings.
  case "$unquoted_assignment_value" in
    *[[:space:]]* | *"("* | *")"* | *"["* | *"]"* | *"{"* | *"}"* | *","* | *";"* | *"<"* | *">"* | *"|"* | *"&"* | *'`'* | *'$'*)
      return 1
      ;;
  esac
  # A lowercase identifier is a variable reference, not an embedded secret.
  if [[ "$unquoted_assignment_value" =~ ^[a-z_][a-z0-9_]*$ ]]; then
    return 1
  fi
  dotted_identifier_re='^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)+$'
  # Dotted config references stay allowed unless their first segment is token-like.
  if [[ "$unquoted_assignment_value" =~ $dotted_identifier_re ]]; then
    value_first_segment="${unquoted_assignment_value%%.*}"
    fallback_lower "$value_first_segment" || return 1
    value_first_segment_lower="$FALLBACK_LOWER"
    case "$value_first_segment_lower" in
      app | application | cfg | conf | config | configs | configuration | constant | constants | context | credentials | credential | creds | ctx | default | defaults | env | environ | environment | os | process | self | setting | settings | this)
        return 1
        ;;
    esac
    # A low-entropy first segment still behaves like an ordinary reference.
    if ! has_credential_entropy "$value_first_segment"; then
      return 1
    fi
  fi
  operator_expression_re='^([A-Za-z_][A-Za-z0-9_]*)([+*/%=]|==|!=)([A-Za-z_][A-Za-z0-9_]*)$'
  # Operators remain allowed when their left side is clearly an identifier.
  if [[ "$unquoted_assignment_value" =~ $operator_expression_re ]]; then
    operator_left_identifier="${BASH_REMATCH[1]}"
    has_credential_entropy "$operator_left_identifier" || return 1
  fi
  # Report only long, token-shaped values the user could need to rotate.
  if [[ ! "$unquoted_assignment_value" =~ ^[A-Za-z0-9._+/=~-]{12,}$ ]]; then
    return 1
  fi
  # Require enough character variety to avoid warning on ordinary words.
  has_credential_entropy "$unquoted_assignment_value" || return 1
  FALLBACK_LITERAL_VALUE="$unquoted_assignment_value"
  return 0
}

# Warns when a changed assignment embeds a literal credential.
# Stock Bash 3 users receive the same Stop-hook decision as newer Bash users.
fallback_scan_literal_assignment() {
  local changed_file_path="$1"
  local credential_key_text="$2"
  local assignment_value_text="$3"
  local literal_value
  local normalized_credential_key

  # An unnormalizable label cannot safely become a user-facing credential family.
  if ! fallback_normalize_key "$credential_key_text"; then
    return 0
  fi
  normalized_credential_key="$FALLBACK_NORMALIZED_KEY"
  case "$normalized_credential_key" in
    tokens | *tokens | tokenizer | tokeniser | tokenize | *tokenizer* | *tokeniser* | *tokenize* | *_count | *_index | *_id | *_name | *_type | *_header | *_url | *_path | *_list | *_re | *_pattern | *_field | *not_secret | *not_a_secret | *non_secret | *no_secret | *not_token | *not_a_token | *non_token | *no_token | *not_password | *not_a_password | *non_password | *no_password | *not_api_key | *not_an_api_key | *non_api_key | *no_api_key | *not_private_key | *not_a_private_key | *non_private_key | *no_private_key)
      return 0
      ;;
    token | secret | secrets | password | passwords | api_key | apikey | private_key | access_token | auth_token | refresh_token | bearer_token | client_secret | client_secrets | secret_key | secret_keys | *_api_key | *_apikey | *_private_key | *_access_token | *_auth_token | *_refresh_token | *_bearer_token | *_client_secret | *_client_secrets | *_secret_key | *_secret_keys | *_password | *_passwords | *_token | *_secret | *_secrets)
      ;;
    *) return 0 ;;
  esac

  # Parse only embedded literals; references remain safe for the user.
  fallback_literal_assignment_value "$assignment_value_text" || return 0
  literal_value="$FALLBACK_LITERAL_VALUE"
  # Short values are not credential-shaped enough to interrupt the turn.
  [ "${#literal_value}" -ge 12 ] || return 0
  # Documented placeholders stay usable in examples and setup screens.
  fallback_is_placeholder "$literal_value" && return 0
  fallback_report "$changed_file_path" "credential assignment ($credential_key_text)"
}

# Scan one portable config assignment after its file type admits literal checks.
fallback_scan_assignment() {
  local path="$1"
  local line="$2"
  local assignment_re='^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_-]*)[[:space:]]*[:=][[:space:]]*(.+)$'

  case "$line" in
    [Ee][Nn][Vv]\ * | [Aa][Rr][Gg]\ *) line="${line#* }" ;;
  esac
  [[ "$line" =~ $assignment_re ]] || return 0
  fallback_scan_literal_assignment "$path" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}"
}

# Scan Docker ARG and ENV forms so container users receive the same secret warning.
fallback_scan_dockerfile_assignment() {
  local path="$1"
  local line="$2"
  local instruction
  local payload
  local first_word
  local key
  local raw_value
  local word
  local -a words=()
  local docker_instruction_re='^[[:space:]]*([aA][rR][gG]|[eE][nN][vV])[[:space:]]+(.*)$'
  local docker_key_value_re='^([A-Za-z_][A-Za-z0-9_-]*)[[:space:]]*=[[:space:]]*(.*)$'
  local docker_key_space_re='^([A-Za-z_][A-Za-z0-9_-]*)[[:space:]]+(.+)$'
  local docker_key_only_re='^([A-Za-z_][A-Za-z0-9_-]*)$'
  local docker_env_word_re='^([A-Za-z_][A-Za-z0-9_-]*)=(.*)$'

  [[ "$line" =~ $docker_instruction_re ]] || return 0
  fallback_lower "${BASH_REMATCH[1]}" || return 0
  instruction="$FALLBACK_LOWER"
  fallback_trim "${BASH_REMATCH[2]}"
  payload="$FALLBACK_TRIMMED"
  # An empty Docker declaration gives the user no literal value to rotate.
  [ -n "$payload" ] || return 0

  # Docker ENV can contain several assignments that users expect checked independently.
  if [ "$instruction" = "env" ]; then
    first_word="${payload%%[[:space:]]*}"
    # Equals-form ENV uses whitespace-separated key/value words.
    if [[ "$first_word" =~ $docker_env_word_re ]]; then
      read -r -a words <<<"$payload"
      # Inspect every ENV word because a later value can carry the user's secret.
      for word in ${words[@]+"${words[@]}"}; do
        # Only key/value words can become literal credential assignments.
        if [[ "$word" =~ $docker_env_word_re ]]; then
          fallback_scan_literal_assignment "$path" "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}"
        fi
      done
      return 0
    fi
  fi

  # Accept Docker equals, space, and declaration-only forms without guessing other grammar.
  if [[ "$payload" =~ $docker_key_value_re ]]; then
    key="${BASH_REMATCH[1]}"
    raw_value="${BASH_REMATCH[2]}"
  # Space-form Docker assignments carry the value after the credential label.
  elif [[ "$payload" =~ $docker_key_space_re ]]; then
    key="${BASH_REMATCH[1]}"
    raw_value="${BASH_REMATCH[2]}"
  # Declaration-only Docker labels remain safe because they carry no literal value.
  elif [[ "$payload" =~ $docker_key_only_re ]]; then
    key="${BASH_REMATCH[1]}"
    raw_value=""
  else
    return 0
  fi

  fallback_scan_literal_assignment "$path" "$key" "$raw_value"
}

# Reset ordered conflict-marker state when compatibility scanning moves to another file.
fallback_reset_conflict() {
  # A new file cannot complete a conflict sequence started in the previous file.
  if [ "$fallback_conflict_path" != "$1" ]; then
    fallback_conflict_path="$1"
    fallback_conflict_state=0
  fi
}

# Apply every compatibility detector to one changed line the user authored.
fallback_scan_line() {
  local path="$1"
  local line="$2"
  local token
  local api_token_reported=0

  fallback_budget_check || return 1
  # A Windows-edited line carries one trailing CR; remove it before user-facing detectors run.
  line="${line%$'\r'}"

  fallback_reset_conflict "$path"
  case "$line" in
    '<<<<<<< '*) fallback_conflict_state=1 ;;
    '=======')
      # The middle marker advances only a conflict already opened in this file.
      if [ "$fallback_conflict_state" -eq 1 ]; then
        fallback_conflict_state=2
      fi
      ;;
    '>>>>>>> '*)
      # A closing marker reports only the complete triplet the user must resolve.
      if [ "$fallback_conflict_state" -eq 2 ]; then
        fallback_report "$path" "merge conflict marker"
      fi
      fallback_conflict_state=0
      ;;
  esac

  # A changed AWS-shaped value tells the user which credential family to rotate.
  if [[ "$line" =~ $AWS_TOKEN_RE ]]; then
    token="${BASH_REMATCH[0]}"
    fallback_is_placeholder "$token" || fallback_report "$path" "AWS access key"
  fi
  # Both legacy and fine-grained GitHub tokens share one user-facing family.
  if [[ "$line" =~ $GITHUB_LEGACY_TOKEN_RE ]]; then
    token="${BASH_REMATCH[0]}"
    fallback_is_placeholder "$token" || fallback_report "$path" "GitHub token"
  # Fine-grained GitHub tokens use a different current provider prefix.
  elif [[ "$line" =~ $GITHUB_FINE_GRAINED_TOKEN_RE ]]; then
    token="${BASH_REMATCH[0]}"
    fallback_is_placeholder "$token" || fallback_report "$path" "GitHub token"
  fi
  # A changed npm token tells the user which registry credential to rotate.
  if [[ "$line" =~ $NPM_TOKEN_RE ]]; then
    token="${BASH_REMATCH[0]}"
    fallback_is_placeholder "$token" || fallback_report "$path" "npm token"
  fi
  # A changed Slack token tells the user which workspace credential to rotate.
  if [[ "$line" =~ $SLACK_TOKEN_RE ]]; then
    token="${BASH_REMATCH[0]}"
    fallback_is_placeholder "$token" || fallback_report "$path" "Slack token"
  fi
  # A labelled provider token takes priority so it is reported only once.
  if [[ "$line" =~ (OPENAI|ANTHROPIC|API_KEY|TOKEN).*($API_TOKEN_RE) ]]; then
    token="${BASH_REMATCH[2]}"
    fallback_is_placeholder "$token" || fallback_report "$path" "API token"
    api_token_reported=1
  fi
  # A bare provider token still blocks when no nearby label was present.
  if [ "$api_token_reported" -eq 0 ] && [[ "$line" =~ (^|[^A-Za-z0-9_])($API_TOKEN_RE)([^A-Za-z0-9_]|$) ]]; then
    token="${BASH_REMATCH[2]}"
    fallback_is_placeholder "$token" || fallback_report "$path" "API token"
  fi
  # A private-key header means the changed file can expose a complete key block.
  if [[ "$line" =~ $PRIVATE_KEY_RE ]]; then
    fallback_report "$path" "private key block"
  fi
  # Docker users need container grammar; other config files use normal assignments.
  if fallback_is_dockerfile_path "$path"; then
    fallback_scan_dockerfile_assignment "$path" "$line"
  # Other config-shaped files use the portable assignment parser.
  elif fallback_is_env_assignment_file "$path"; then
    fallback_scan_assignment "$path" "$line"
  fi
}

# Decode a Git diff destination so compatibility scanning names the user's real file.
# $1 is decorated header text; sets FALLBACK_DIFF_PATH, empty when unusable.
# Returns 0 when decoded, or 1 so incomplete coverage can block the turn.
fallback_decode_diff_path() {
  local encoded_path="${1#+++ }"
  FALLBACK_DIFF_PATH=""

  case "$encoded_path" in
    *$'\t') encoded_path="${encoded_path%$'\t'}" ;;
  esac
  case "$encoded_path" in
    \"*\")
      encoded_path="${encoded_path#\"}"
      encoded_path="${encoded_path%\"}"
      ;;
  esac
  case "$encoded_path" in
    b/*) encoded_path="${encoded_path#b/}" ;;
  esac
  # An empty destination cannot identify the file the user needs to inspect.
  [ -n "$encoded_path" ] || return 1
  # Bash's builtin printf understands Git's octal and escaped-quote notation.
  printf -v FALLBACK_DIFF_PATH '%b' "$encoded_path" || return 1
  # A decoded empty name still cannot receive a trustworthy finding.
  [ -n "$FALLBACK_DIFF_PATH" ]
}

# Streams added diff lines without loading the user's whole tracked or staged file.
# Binary changed paths are reported as incomplete because they have no text hunks.
fallback_scan_diff() {
  local repository_root="$1"
  shift
  local binary_inventory
  local binary_record
  local binary_path
  local changed_file_path=""
  local diff_line
  local diff_stream
  local expect_file_header=0
  local scan_changed_file=0

  fallback_conflict_path=""
  fallback_conflict_state=0
  fallback_next_temp_path "binary-inventory"
  binary_inventory="$FALLBACK_TEMP_PATH"
  # Git must enumerate binary paths before the compatibility text stream can claim coverage.
  if ! git -C "$repository_root" \
    -c core.quotepath=off \
    diff --no-ext-diff --no-color --numstat --no-renames --diff-filter=ACMR -z "$@" >"$binary_inventory" 2>/dev/null; then
    fallback_mark_incomplete "Git binary inventory failed"
    return 1
  fi
  # Every binary record represents changed content the text scanner cannot inspect.
  while IFS= read -r -d '' binary_record; do
    case "$binary_record" in
      $'-\t-\t'*)
        binary_path="${binary_record#$'-\t-\t'}"
        fallback_mark_coverage_gap "$binary_path" "binary changed path not scanned"
        ;;
    esac
  done <"$binary_inventory"

  fallback_next_temp_path "diff-stream"
  diff_stream="$FALLBACK_TEMP_PATH"
  # Git must produce the complete added-hunk stream before compatibility scanning can pass.
  if ! git -C "$repository_root" \
    -c core.quotepath=off \
    -c diff.noprefix=false \
    -c diff.mnemonicprefix=false \
    -c diff.srcprefix=a/ \
    -c diff.dstprefix=b/ \
    diff --no-ext-diff --no-color --unified=0 "$@" >"$diff_stream" 2>/dev/null; then
    fallback_mark_incomplete "Git diff command failed"
    return 1
  fi
  # Read every added diff line, including a final line without a newline.
  while IFS= read -r diff_line || [ -n "$diff_line" ]; do
    fallback_budget_check || break
    case "$diff_line" in
      'diff --git '*)
        expect_file_header=1
        changed_file_path=""
        scan_changed_file=0
        ;;
      '+++ /dev/null')
        # A real deleted-file header ends scanning, while added header-shaped text stays content.
        if [ "$expect_file_header" -eq 1 ]; then
          expect_file_header=0
          changed_file_path=""
          scan_changed_file=0
        # Added content resembling a header stays attached to the active user file.
        elif [ -n "$changed_file_path" ] && [ "$scan_changed_file" -eq 1 ]; then
          fallback_scan_line "$changed_file_path" "${diff_line#+}"
        fi
        ;;
      '+++ '*)
        # Only the destination header after a Git section selects a new user path.
        if [ "$expect_file_header" -eq 1 ]; then
          expect_file_header=0
          # A decoded destination path can receive findings the user recognizes.
          if fallback_decode_diff_path "$diff_line"; then
            changed_file_path="$FALLBACK_DIFF_PATH"
          else
            changed_file_path=""
          fi
          # A decoded text header can stream added hunks regardless of full file size.
          if [ -n "$changed_file_path" ]; then
            scan_changed_file=1
          else
            scan_changed_file=0
          fi
        # Outside the accepted header slot, header-shaped text is user content.
        elif [ -n "$changed_file_path" ] && [ "$scan_changed_file" -eq 1 ]; then
          # Outside the one accepted header slot, +++-shaped text is content.
          fallback_scan_line "$changed_file_path" "${diff_line#+}"
        fi
        ;;
      +*)
        # An eligible path means the added line can affect the user's Stop result.
        if [ -n "$changed_file_path" ] && [ "$scan_changed_file" -eq 1 ]; then
          fallback_scan_line "$changed_file_path" "${diff_line#+}"
        fi
        ;;
    esac
  done <"$diff_stream"
}

# Open one approved full-content file without a subshell on the compatibility path.
fallback_open_scan_file() {
  exec 3<"$1"
}

# Scan one non-ignored full-content path or report why user coverage is incomplete.
fallback_scan_file() {
  local root="$1"
  local path="$2"
  local full_path="$root/$path"
  local size
  local line
  local grep_status

  # Untracked symlinks stay outside the committable-content boundary and are never followed.
  [ ! -L "$full_path" ] || return 0
  # A vanished or unreadable declared path leaves the user's scan coverage incomplete.
  if [ ! -f "$full_path" ] || [ ! -r "$full_path" ]; then
    fallback_mark_coverage_gap "$path" "untracked path unavailable"
    return 0
  fi
  # The whole-file byte count decides whether untracked text fits the configured cap.
  if ! size=$(wc -c <"$full_path" 2>/dev/null); then
    fallback_mark_incomplete "byte-count command failed"
    return 1
  fi
  case "$size" in
    '' | *[!0-9[:space:]]*)
      fallback_mark_incomplete "byte-count command returned invalid output"
      return 1
      ;;
  esac
  # An empty file contains no user text that can carry a finding.
  [ "$size" -gt 0 ] || return 0

  LC_ALL=C grep -Iq '' "$full_path" 2>/dev/null
  grep_status=$?
  case "$grep_status" in
    0) ;;
    1)
      fallback_mark_coverage_gap "$path" "binary untracked path not scanned"
      return 0
      ;;
    *)
      fallback_mark_incomplete "binary-content gate failed"
      return 1
      ;;
  esac
  # Whole untracked content above the cap cannot be streamed from a trusted baseline.
  if [ "$size" -gt "$fallback_max_bytes" ]; then
    fallback_mark_coverage_gap "$path" "oversized untracked text not scanned"
    return 0
  fi

  # Opening after all gates catches a file the user changed or removed during scanning.
  if ! fallback_open_scan_file "$full_path" 2>/dev/null; then
    fallback_mark_incomplete "selected content became unreadable"
    return 1
  fi

  fallback_conflict_path=""
  fallback_conflict_state=0
  # Read every admitted user line, including a final line without a newline.
  while IFS= read -r line || [ -n "$line" ]; do
    fallback_scan_line "$path" "$line" || break
  done <&3
  exec 3<&-
}

# Exercise clean, finding, incomplete, and compatibility outcomes from the installed hook.
# Users run this after install or upgrade to confirm both scanner paths are operational.
post_turn_self_test() (
  local hook_result
  local scanner_setting
  local self_test_root
  local self_test_script="${BASH_SOURCE[0]}"
  local synthetic_aws_token="AKIA${POST_TURN_SELF_TEST_TOKEN_SUFFIX:-1234567890ABCDEF}"

  # A relative invocation must remain callable after the fixture changes working directory.
  case "$self_test_script" in
    /*) ;;
    *) self_test_script="$(pwd)/$self_test_script" ;;
  esac
  self_test_root="$(mktemp -d 2>/dev/null)" || self_test_root=""
  # Without an isolated repo, the installed contract cannot prove a user-safe result.
  if [ -z "$self_test_root" ]; then
    printf 'post-turn-safety self-test: fixture setup failed\n' >&2
    return 2
  fi
  trap 'rm -rf -- "$self_test_root"' EXIT

  # Fixture setup must create a real baseline before any user outcome is asserted.
  if ! git -C "$self_test_root" init -q >/dev/null 2>&1 || \
    ! printf '# post-turn safety self-test\n' >"$self_test_root/README.md" || \
    ! git -C "$self_test_root" add README.md >/dev/null 2>&1 || \
    ! git -C "$self_test_root" -c user.name=goat-flow-self-test \
      -c user.email=goat-flow-self-test@example.invalid commit -qm initial >/dev/null 2>&1; then
    printf 'post-turn-safety self-test: fixture setup failed\n' >&2
    return 2
  fi
  # The recursive hook resolves the current project, so enter the disposable user fixture.
  if ! cd "$self_test_root"; then
    printf 'post-turn-safety self-test: fixture setup failed\n' >&2
    return 2
  fi

  # Native and Bash 3 compatibility users must see the same three result classes.
  for scanner_setting in 0 1; do
    printf 'API_KEY=your_api_key_here\n' >"$self_test_root/settings.env"
    GOAT_FLOW_POST_TURN_SAFETY_FORCE_BASH3_FALLBACK="$scanner_setting" \
      bash "$self_test_script" </dev/null >/dev/null 2>&1
    hook_result=$?
    # A safe placeholder should let the user finish the turn.
    if [ "$hook_result" -ne 0 ]; then
      printf 'post-turn-safety self-test: clean case failed on scanner %s\n' "$scanner_setting" >&2
      return 2
    fi

    printf 'AWS_ACCESS_KEY_ID=%s\n' "$synthetic_aws_token" >"$self_test_root/settings.env"
    GOAT_FLOW_POST_TURN_SAFETY_FORCE_BASH3_FALLBACK="$scanner_setting" \
      bash "$self_test_script" </dev/null >/dev/null 2>&1
    hook_result=$?
    # A high-confidence changed token should block the user's turn.
    if [ "$hook_result" -ne 2 ]; then
      printf 'post-turn-safety self-test: finding case failed on scanner %s\n' "$scanner_setting" >&2
      return 2
    fi

    printf 'API_KEY=your_api_key_here\n' >"$self_test_root/settings.env"
    printf '\000binary fixture\n' >"$self_test_root/binary.dat"
    GOAT_FLOW_POST_TURN_SAFETY_FORCE_BASH3_FALLBACK="$scanner_setting" \
      bash "$self_test_script" </dev/null >/dev/null 2>&1
    hook_result=$?
    # Unscannable changed content should report incomplete rather than a false clean result.
    if [ "$hook_result" -ne 2 ]; then
      printf 'post-turn-safety self-test: incomplete case failed on scanner %s\n' "$scanner_setting" >&2
      return 2
    fi
    rm -f -- "$self_test_root/binary.dat"
  done

  printf 'post-turn-safety self-test: ok\n'
)

# Run the complete stock-macOS scan and return the user's final Stop decision.
fallback_main() {
  local root
  local path
  local path_list
  local head_status

  case "$fallback_max_seconds" in '' | *[!0-9]*) fallback_max_seconds=60 ;; esac
  case "$fallback_max_bytes" in '' | *[!0-9]*) fallback_max_bytes=1048576 ;; esac
  case "$fallback_max_findings" in '' | *[!0-9]*) fallback_max_findings=20 ;; esac

  # Without a Git root, the hook cannot identify the project changes for this turn.
  if ! root=$(git rev-parse --show-toplevel 2>/dev/null) || [ -z "$root" ]; then
    post_turn_result_detail="The selected Git repository root could not be opened"
    printf 'post-turn-safety: scan incomplete (git repository root unavailable).\n' >&2
    return 2
  fi

  # A root the process cannot enter cannot be scanned on the user's behalf.
  if ! cd "$root" 2>/dev/null; then
    post_turn_result_detail="The selected Git repository root could not be entered"
    printf 'post-turn-safety: scan incomplete (repository root cannot be entered).\n' >&2
    return 2
  fi

  # Temporary scan output is required before Git content can be inspected safely.
  if ! fallback_workdir=$(mktemp -d 2>/dev/null) || [ -z "$fallback_workdir" ]; then
    post_turn_result_detail="A temporary safety-scan workspace could not be created"
    printf 'post-turn-safety: scan incomplete (scan workspace unavailable).\n' >&2
    finish_infrastructure_failure "$root" "fallback:scan workspace unavailable"
    return $?
  fi
  trap 'rm -rf "$fallback_workdir"' EXIT
  post_turn_result_records_path="$fallback_workdir/hook-result-records"

  git -C "$root" rev-parse --verify HEAD >/dev/null 2>&1
  head_status=$?
  # A committed baseline lets the compatibility path stream changed hunks.
  if [ "$head_status" -eq 0 ]; then
    fallback_scan_diff "$root" HEAD
    # Staged content runs only while the worktree scan remains complete.
    if [ "$fallback_bail" -eq 0 ]; then
      fallback_scan_diff "$root" --cached
    fi
  # An unborn repository has tracked index content but no committed baseline.
  elif [ "$head_status" -eq 128 ]; then
    fallback_next_temp_path "tracked-paths"
    path_list="$FALLBACK_TEMP_PATH"
    # An unborn repository scans every tracked path because no committed baseline exists.
    if git -C "$root" ls-files -z >"$path_list" 2>/dev/null; then
      # Each tracked path must complete before the compatibility result can pass.
      while IFS= read -r -d '' path; do
        fallback_budget_check || break
        fallback_scan_file "$root" "$path"
        [ "$fallback_bail" -eq 0 ] || break
      done <"$path_list"
    else
      fallback_mark_incomplete "Git tracked-path inventory failed"
    fi
    # The staged root diff preserves index-only content after full worktree scanning.
    if [ "$fallback_bail" -eq 0 ]; then
      fallback_scan_diff "$root" --cached --root
    fi
  else
    fallback_mark_incomplete "Git HEAD inspection failed"
  fi

  # Non-ignored untracked content runs only after tracked coverage remains complete.
  if [ "$fallback_bail" -eq 0 ]; then
    fallback_next_temp_path "untracked-paths"
    path_list="$FALLBACK_TEMP_PATH"
    # Git must enumerate every non-ignored untracked path the user could commit.
    if git -C "$root" ls-files --others --exclude-standard -z >"$path_list" 2>/dev/null; then
      # Each untracked path must scan or report its own explicit coverage gap.
      while IFS= read -r -d '' path; do
        fallback_budget_check || break
        fallback_scan_file "$root" "$path"
        [ "$fallback_bail" -eq 0 ] || break
      done <"$path_list"
    else
      fallback_mark_incomplete "Git untracked-path inventory failed"
    fi
  fi

  # Infrastructure and budget failures explain why compatibility scanning did not finish.
  if [ "$fallback_bail" -ne 0 ]; then
    printf 'post-turn-safety: Bash 3 compatibility scan incomplete (%s).\n' "$fallback_incomplete_reason" >&2
  fi

  # Findings always block, even when another scanner condition also became incomplete.
  if [ "$fallback_findings" -gt 0 ]; then
    clear_stop_reentry_state "$root" >/dev/null 2>&1
    # The cap hides duplicate detail, then reports how many user actions remain.
    if [ "$fallback_findings" -gt "$fallback_max_findings" ]; then
      printf 'post-turn-safety: %s additional finding(s) hidden by output cap.\n' "$((fallback_findings - fallback_max_findings))" >&2
    fi
    printf 'post-turn-safety: fix or remove the flagged changed content before stopping.\n' >&2
    return 2
  fi
  # Binary or oversized declared content stays blocked on every provider re-entry.
  if [ "$fallback_coverage_gap" -ne 0 ]; then
    clear_stop_reentry_state "$root" >/dev/null 2>&1
    return 2
  fi
  # A compatibility failure stays blocked unless exact infrastructure re-entry can end loudly.
  if [ "$fallback_bail" -ne 0 ]; then
    # Only a command failure can use one exact fingerprinted terminal re-entry.
    if [ "$fallback_incomplete_kind" = "command" ]; then
      finish_infrastructure_failure "$root" "fallback:$fallback_incomplete_reason"
      return $?
    fi
    clear_stop_reentry_state "$root" >/dev/null 2>&1
    return 2
  fi
  clear_stop_reentry_state "$root" >/dev/null 2>&1
  return 0
}

# The explicit installed check runs without consuming a provider Stop payload.
if [ "$post_turn_action" = "self-test" ]; then
  post_turn_self_test
  exit $?
fi

# Malformed or oversized provider input cannot be treated as a clean user turn.
if ! read_stop_context; then
  post_turn_result_detail="The coding agent supplied an invalid Stop payload: $stop_payload_error"
  post_turn_result_reason_override="input-invalid"
  printf 'post-turn-safety: scan incomplete (invalid Stop payload: %s).\n' "$stop_payload_error" >&2
  # Managed users need the malformed-input result inside provider feedback, not only terminal text.
  if [ "$post_turn_migrated_result_mode" -ne 0 ]; then
    POST_TURN_HOOK_VERSION="$post_turn_hook_version" emit_post_turn_hook_result "input" 2
    exit $?
  fi
  exit 2
fi

# Stock macOS Bash uses the compatibility implementation with the same Stop context.
if ((BASH_VERSINFO[0] < 4)) || [ "${GOAT_FLOW_POST_TURN_SAFETY_FORCE_BASH3_FALLBACK:-0}" = 1 ]; then
  finish_post_turn_scan "fallback" fallback_main "$@"
  exit $?
fi


# extglob is required by the +([[:space:]]) trim patterns in strip_space.
shopt -s extglob

MAX_FILE_BYTES="${GOAT_FLOW_POST_TURN_SAFETY_MAX_BYTES:-1048576}"
MAX_FINDINGS="${GOAT_FLOW_POST_TURN_SAFETY_MAX_FINDINGS:-20}"
# Wall-clock budget for the whole scan. The registered agent-side hook timeout
# must stay above this so the incomplete-scan diagnostic below prints before
# the runner kills the process (same layering as gruff-code-quality.sh).
MAX_SECONDS="${GOAT_FLOW_POST_TURN_SAFETY_MAX_SECONDS:-60}"
case "$MAX_SECONDS" in
  '' | *[!0-9]*) MAX_SECONDS=60 ;;
esac

# External commands receive at most this many path arguments per invocation so
# batched calls stay far below the ~32k character Windows command-line limit.
CHUNK_SIZE=64

findings=0
reported_findings="
"
merge_conflict_scan_path=""
merge_conflict_scan_state=0

# Budget bookkeeping: BAIL flips once SECONDS crosses MAX_SECONDS; every scan
# loop checks it and unwinds. PENDING_FILES over-counts remaining candidate
# files (never under-counts) so the incomplete-scan message stays honest.
BAIL=0
PENDING_FILES=0
INCOMPLETE_REASON=""
INCOMPLETE_KIND=""
TEMP_FILE_SEQUENCE=0
COVERAGE_GAP=0
declare -a COVERAGE_GAP_MESSAGES=()
declare -A COVERAGE_GAP_REPORTED=()

# Preserve the first native failure that explains why the user's scan stopped.
mark_scan_incomplete() {
  # Later failures must not replace the first actionable explanation shown to the user.
  if [ -z "$INCOMPLETE_REASON" ]; then
    INCOMPLETE_KIND="$1"
    INCOMPLETE_REASON="$2"
  fi
  BAIL=1
}

# Record one declared changed path that cannot receive a complete text scan for the user.
mark_coverage_gap() {
  local coverage_key="$1|$2"

  # Staged and worktree views of one path should give the user one gap message.
  if [ -n "${COVERAGE_GAP_REPORTED[$coverage_key]:-}" ]; then
    return 0
  fi
  COVERAGE_GAP=1
  COVERAGE_GAP_REPORTED["$coverage_key"]=1
  COVERAGE_GAP_MESSAGES+=("$2 in $1")
  record_post_turn_result_finding "coverage-gap" "$2" "$1"
}

# Stop native work when the user's time limit or a prior failure makes it incomplete.
budget_check() {
  # Reaching the configured limit leaves some user changes unverified.
  if ((BAIL == 0)) && ((SECONDS >= MAX_SECONDS)); then
    mark_scan_incomplete "budget" "budget ${MAX_SECONDS}s exceeded"
  fi
  ((BAIL == 0))
}

# Reserve one deterministic scratch path for the next native scan result.
next_temp_path() {
  TEMP_FILE_SEQUENCE=$((TEMP_FILE_SEQUENCE + 1))
  TEMP_PATH="$WORKDIR/$1-$TEMP_FILE_SEQUENCE"
}

# Grep exit 1 is its documented no-match result. Any other non-zero status
# means candidate selection or content gating did not complete.
capture_grep_output() {
  local output="$1"
  local failure_reason="$2"
  local status
  shift 2

  LC_ALL=C grep "$@" >"$output" 2>/dev/null
  status=$?
  GREP_STATUS=$status
  # Grep errors mean candidate selection did not complete for the user's changes.
  if [ "$status" -gt 1 ]; then
    mark_scan_incomplete "command" "$failure_reason"
    return 1
  fi
  return 0
}

# Resolve the project whose changed content determines the user's Stop result.
repo_root() {
  git rev-parse --show-toplevel 2>/dev/null
}

# Report whether the project has a committed baseline for changed-hunk scanning.
has_head() {
  git rev-parse --verify HEAD >/dev/null 2>&1
}

# Sets STRIPPED to $1 without leading/trailing [[:space:]]. A function output
# via global instead of stdout: $(...) forks a subshell, and this runs on the
# per-line hot path.
strip_space() {
  STRIPPED="${1##+([[:space:]])}"
  STRIPPED="${STRIPPED%%+([[:space:]])}"
}

# Keep documented placeholder values usable in examples and setup screens.
is_placeholder_token() {
  local value
  value="${1,,}"
  case "$value" in
    "" | akiaiosfodnn7example | asiaiosfodnn7example)
      return 0
      ;;
  esac
  [[ "$value" =~ $PLACEHOLDER_ALL_X_RE ]] && return 0
  [[ "$value" =~ $PLACEHOLDER_MARKER_RE ]]
}

# Exclude labels such as token counts or secret names that do not hold credentials.
is_excluded_credential_key() {
  local key="$1"
  case "$key" in
    tokens | *tokens | tokenizer | tokeniser | tokenize | *tokenizer* | *tokeniser* | *tokenize* | *_count | *_index | *_id | *_name | *_type | *_header | *_url | *_path | *_list | *_re | *_pattern | *_field)
      return 0
      ;;
    *not_secret | *not_a_secret | *non_secret | *no_secret | *not_token | *not_a_token | *non_token | *no_token | *not_password | *not_a_password | *non_password | *no_password | *not_api_key | *not_an_api_key | *non_api_key | *no_api_key | *not_private_key | *not_a_private_key | *non_private_key | *no_private_key)
      return 0
      ;;
  esac
  return 1
}

# Normalize credential labels so camelCase and kebab-case receive the same verdict.
# This keeps user feedback consistent across common config styles.
# $1 is the label; sets NORMALIZED_KEY, which is empty only when the input is empty.
normalize_credential_key() {
  local raw="$1" first="" second="" c i n
  n=${#raw}
  # Walk the original label so camelCase boundaries become visible to the classifier.
  for ((i = 0; i < n; i++)); do
    c=${raw:i:1}
    # A lowercase-to-uppercase boundary starts a new credential-label word.
    if ((i > 0)) && [[ ${raw:i-1:1} == [[:lower:][:digit:]] && $c == [[:upper:]] ]]; then
      first+="_"
    fi
    first+="$c"
  done
  n=${#first}
  # Walk the intermediate label so acronym endings also become separate words.
  for ((i = 0; i < n; i++)); do
    c=${first:i:1}
    # The last capital before lowercase text starts the next readable word.
    if ((i > 0 && i + 1 < n)) && [[ ${first:i-1:1} == [[:upper:]] && $c == [[:upper:]] && ${first:i+1:1} == [[:lower:]] ]]; then
      second+="_"
    fi
    second+="$c"
  done
  second="${second,,}"
  NORMALIZED_KEY="${second//-/_}"
}

# Recognize credential labels across common config naming styles.
is_credential_key() {
  local key
  normalize_credential_key "$1"
  key="$NORMALIZED_KEY"
  is_excluded_credential_key "$key" && return 1
  case "$key" in
    token | secret | secrets | password | passwords | api_key | apikey | private_key | access_token | auth_token | refresh_token | bearer_token | client_secret | client_secrets | secret_key | secret_keys)
      return 0
      ;;
    *_api_key | *_apikey | *_private_key | *_access_token | *_auth_token | *_refresh_token | *_bearer_token | *_client_secret | *_client_secrets | *_secret_key | *_secret_keys | *_password | *_passwords | *_token | *_secret | *_secrets)
      return 0
      ;;
  esac
  return 1
}

# Warn when one changed config assignment embeds a literal credential the user can rotate.
scan_literal_credential_assignment() {
  local path="$1"
  local key="$2"
  local raw_value="$3"
  local value

  # An empty label gives the user no credential family to act on.
  [ -n "$key" ] || return 0
  is_credential_key "$key" || return 0

  # Only one literal value the user can rotate should become a finding.
  if ! literal_assignment_value "$raw_value"; then
    return 0
  fi
  value="$LITERAL_VALUE"
  [ "${#value}" -ge 12 ] || return 0
  # Assignment values use delimiter-aware placeholder matching so ordinary
  # substrings such as "test" inside a generated password do not suppress a
  # credential finding. Known documented token placeholders are handled there.
  if is_placeholder_token "$value"; then
    return 0
  fi

  report_finding "$path" "credential assignment ($key)"
}

# Scan Docker ARG and ENV forms so container users receive the same secret warning.
scan_dockerfile_assignment() {
  local path="$1"
  local line="$2"
  local instruction
  local payload
  local first_word
  local key
  local raw_value
  local word
  local -a words=()
  local docker_instruction_re='^[[:space:]]*([aA][rR][gG]|[eE][nN][vV])[[:space:]]+(.*)$'
  local docker_key_value_re='^([A-Za-z_][A-Za-z0-9_-]*)[[:space:]]*=[[:space:]]*(.*)$'
  local docker_key_space_re='^([A-Za-z_][A-Za-z0-9_-]*)[[:space:]]+(.+)$'
  local docker_key_only_re='^([A-Za-z_][A-Za-z0-9_-]*)$'
  local docker_env_word_re='^([A-Za-z_][A-Za-z0-9_-]*)=(.*)$'

  [[ "$line" =~ $docker_instruction_re ]] || return 0
  instruction="${BASH_REMATCH[1],,}"
  strip_space "${BASH_REMATCH[2]}"
  payload="$STRIPPED"
  # An empty Docker declaration gives the user no literal value to rotate.
  [ -n "$payload" ] || return 0

  # Docker ENV can contain several assignments that users expect checked independently.
  if [[ "$instruction" == "env" ]]; then
    first_word="${payload%%[[:space:]]*}"
    # Equals-form ENV uses whitespace-separated key/value words.
    if [[ "$first_word" =~ $docker_env_word_re ]]; then
      read -r -a words <<<"$payload"
      # Inspect every ENV word because a later value can carry the user's secret.
      for word in ${words[@]+"${words[@]}"}; do
        # Only key/value words can become literal credential assignments.
        if [[ "$word" =~ $docker_env_word_re ]]; then
          scan_literal_credential_assignment "$path" "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}"
        fi
      done
      return 0
    fi
  fi

  # Accept Docker equals, space, and declaration-only forms without guessing other grammar.
  if [[ "$payload" =~ $docker_key_value_re ]]; then
    key="${BASH_REMATCH[1]}"
    raw_value="${BASH_REMATCH[2]}"
  # Space-form Docker assignments carry the value after the credential label.
  elif [[ "$payload" =~ $docker_key_space_re ]]; then
    key="${BASH_REMATCH[1]}"
    raw_value="${BASH_REMATCH[2]}"
  # Declaration-only Docker labels remain safe because they carry no literal value.
  elif [[ "$payload" =~ $docker_key_only_re ]]; then
    key="${BASH_REMATCH[1]}"
    raw_value=""
  else
    return 0
  fi

  scan_literal_credential_assignment "$path" "$key" "$raw_value"
}

# Extracts a literal secret-looking value from an assignment right-hand side.
# On success sets LITERAL_VALUE and returns 0; returns 1 when the value is a
# reference, expression, identifier, or otherwise not a literal credential.
literal_assignment_value() {
  local after
  local bare
  local dotted_identifier_re
  local first_segment
  local first_segment_lower
  local operator_expression_re
  local raw
  local rest
  local value

  LITERAL_VALUE=""
  strip_space "$1"
  raw="$STRIPPED"
  case "$raw" in
    [fF]\"* | [fF]\'* | [fF][rR]\"* | [fF][rR]\'* | [rR][fF]\"* | [rR][fF]\'*)
      return 1
      ;;
  esac

  case "${raw:0:1}" in
    '"')
      rest="${raw:1}"
      [[ "$rest" == *\"* ]] || return 1
      value="${rest%%\"*}"
      case "$value" in
        *[[:space:]]* | *'$'*) return 1 ;;
      esac
      is_reference_or_interpolation "$value" && return 1
      after="${rest#*\"}"
      strip_space "$after"
      after="$STRIPPED"
      # Only an assignment-ending suffix may follow the closing quote.
      suffix_ends_assignment "$after" || return 1
      LITERAL_VALUE="$value"
      return 0
      ;;
    "'")
      rest="${raw:1}"
      [[ "$rest" == *"'"* ]] || return 1
      value="${rest%%\'*}"
      case "$value" in
        *[[:space:]]*) return 1 ;;
      esac
      is_reference_or_interpolation "$value" && return 1
      after="${rest#*\'}"
      strip_space "$after"
      after="$STRIPPED"
      # Only an assignment-ending suffix may follow the closing quote.
      suffix_ends_assignment "$after" || return 1
      LITERAL_VALUE="$value"
      return 0
      ;;
  esac

  bare="${raw%%#*}"
  strip_space "$bare"
  bare="$STRIPPED"
  # An empty assignment gives the user no credential to rotate.
  [ -n "$bare" ] || return 1
  case "$bare" in
    *[[:space:]]* | *"("* | *")"* | *"["* | *"]"* | *"{"* | *"}"* | *","* | *";"* | *"<"* | *">"* | *"|"* | *"&"* | *'`'* | *'$'*)
      return 1
      ;;
  esac
  # A simple lowercase identifier is a runtime reference, not an embedded user secret.
  if [[ "$bare" =~ ^[a-z_][a-z0-9_]*$ ]]; then
    return 1
  fi
  dotted_identifier_re='^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)+$'
  # Common dotted config references stay allowed unless their first segment is token-like.
  if [[ "$bare" =~ $dotted_identifier_re ]]; then
    first_segment="${bare%%.*}"
    first_segment_lower="${first_segment,,}"
    case "$first_segment_lower" in
      app | application | cfg | conf | config | configs | configuration | constant | constants | context | credentials | credential | creds | ctx | default | defaults | env | environ | environment | os | process | self | setting | settings | this)
        return 1
        ;;
    esac
    # Low-entropy dotted prefixes behave like ordinary application references.
    if ! has_credential_entropy "$first_segment"; then
      return 1
    fi
  fi
  operator_expression_re='^([A-Za-z_][A-Za-z0-9_]*)([+*/%=]|==|!=)([A-Za-z_][A-Za-z0-9_]*)$'
  # Identifier-led expressions stay allowed unless the left side itself is token-shaped.
  if [[ "$bare" =~ $operator_expression_re ]]; then
    has_credential_entropy "${BASH_REMATCH[1]}" || return 1
  fi
  # Short or punctuated expressions are not high-confidence rotatable credentials.
  if [[ ! "$bare" =~ ^[A-Za-z0-9._+/=~-]{12,}$ ]]; then
    return 1
  fi
  has_credential_entropy "$bare" || return 1
  LITERAL_VALUE="$bare"
  return 0
}

# Identify Dockerfile paths before applying their user-facing assignment grammar.
is_dockerfile_path() {
  local basename
  local lower_path

  lower_path="${1,,}"
  basename="${lower_path##*/}"
  case "$basename" in
    dockerfile | dockerfile.* | *.dockerfile)
      return 0
      ;;
  esac
  return 1
}

# Admit only config-shaped files to generic credential-assignment checks.
is_env_assignment_file() {
  local basename
  local lower_path

  lower_path="${1,,}"
  basename="${lower_path##*/}"
  case "$basename" in
    .env* | *.env | *.env.* | dockerfile | dockerfile.* | *.dockerfile | *.sh | *.bash | *.zsh | *.ksh | *.yaml | *.yml | *.ini | *.toml | *.properties | *.conf | *.cfg)
      return 0
      ;;
  esac
  return 1
}

# Emit one native finding per family and path without repeating user guidance.
report_finding() {
  local path="$1"
  local family="$2"
  local fingerprint="${path}|${family}"
  case "$reported_findings" in
    *"
$fingerprint
"*) return 0 ;;
  esac
  reported_findings="${reported_findings}${fingerprint}
"
  findings=$((findings + 1))
  record_post_turn_result_finding "safety-hazard" "Blocked $family in changed content" "$path"
  # The output cap keeps a large edit readable while the final count stays honest.
  if [ "$findings" -le "$MAX_FINDINGS" ]; then
    printf 'post-turn-safety: blocked %s in %s\n' "$family" "$path" >&2
  fi
}

# Scan a config assignment only after its file type and label make it relevant.
scan_env_assignment() {
  local path="$1"
  local line="$2"
  local key
  local raw_value
  local env_assignment_re='^[[:space:]]*((export|EXPORT|arg|ARG|env|ENV)[[:space:]]+)?([A-Za-z_][A-Za-z0-9_-]*)[[:space:]]*[:=][[:space:]]*(.*)$'

  # Docker users need container grammar; other config files use normal assignments.
  if is_dockerfile_path "$path"; then
    scan_dockerfile_assignment "$path" "$line"
    return 0
  fi

  [[ "$line" =~ $env_assignment_re ]] || return 0
  key="${BASH_REMATCH[3]}"
  raw_value="${BASH_REMATCH[4]}"
  scan_literal_credential_assignment "$path" "$key" "$raw_value"
}

# Report a raw token unless the matched value is an obvious placeholder.
# $1 is the user file, $2 the token family, and $3 the match; empty cannot be a finding.
# Returns clean for a placeholder, otherwise the user-facing finding status.
report_token_if_real() {
  local path="$1"
  local family="$2"
  local token="$3"
  is_placeholder_token "$token" && return 0
  report_finding "$path" "$family"
}

# Reset ordered conflict-marker state when native scanning moves to another file.
reset_merge_conflict_scan() {
  merge_conflict_scan_path="$1"
  merge_conflict_scan_state=0
}

# Track a complete conflict triplet so Markdown headings do not block the user.
scan_merge_conflict_marker() {
  local path="$1"
  local line="$2"

  # A new file cannot complete a conflict sequence started in the previous file.
  if [ "$merge_conflict_scan_path" != "$path" ]; then
    reset_merge_conflict_scan "$path"
  fi

  case "$line" in
    "<<<<<<< "*)
      merge_conflict_scan_state=1
      ;;
    "=======")
      # The middle marker advances only a conflict already opened in this file.
      if [ "$merge_conflict_scan_state" -eq 1 ]; then
        merge_conflict_scan_state=2
      fi
      ;;
    ">>>>>>> "*)
      # A closing marker reports only the complete triplet the user must resolve.
      if [ "$merge_conflict_scan_state" -eq 2 ]; then
        report_finding "$path" "merge conflict marker"
      fi
      merge_conflict_scan_state=0
      ;;
    *) ;;
  esac
}

# Apply every native detector to one changed line the user authored.
scan_line() {
  local path="$1"
  local line="$2"
  local api_token_reported=0

  # A Windows-edited line carries one trailing CR; remove it before user-facing detectors run.
  line="${line%$'\r'}"

  scan_merge_conflict_marker "$path" "$line"

  # A private-key header means the changed file can expose a complete key block.
  if [[ "$line" =~ $PRIVATE_KEY_RE ]]; then
    report_finding "$path" "private key block"
  fi

  # A changed AWS-shaped value tells the user which credential family to rotate.
  if [[ "$line" =~ $AWS_TOKEN_RE ]]; then
    report_token_if_real "$path" "AWS access key" "${BASH_REMATCH[0]}"
  fi
  # Both legacy and fine-grained GitHub tokens share one user-facing family.
  if [[ "$line" =~ $GITHUB_LEGACY_TOKEN_RE || "$line" =~ $GITHUB_FINE_GRAINED_TOKEN_RE ]]; then
    report_token_if_real "$path" "GitHub token" "${BASH_REMATCH[0]}"
  fi
  # A changed npm token tells the user which registry credential to rotate.
  if [[ "$line" =~ $NPM_TOKEN_RE ]]; then
    report_token_if_real "$path" "npm token" "${BASH_REMATCH[0]}"
  fi
  # A changed Slack token tells the user which workspace credential to rotate.
  if [[ "$line" =~ $SLACK_TOKEN_RE ]]; then
    report_token_if_real "$path" "Slack token" "${BASH_REMATCH[0]}"
  fi
  # A labelled provider token takes priority so it is reported only once.
  if [[ "$line" =~ (OPENAI|ANTHROPIC|API_KEY|TOKEN).*($API_TOKEN_RE) ]]; then
    report_token_if_real "$path" "API token" "${BASH_REMATCH[2]}"
    api_token_reported=1
  fi
  # A bare provider token still blocks when no nearby label was present.
  if [ "$api_token_reported" -eq 0 ] && [[ "$line" =~ (^|[^A-Za-z0-9_])($API_TOKEN_RE)([^A-Za-z0-9_]|$) ]]; then
    report_token_if_real "$path" "API token" "${BASH_REMATCH[2]}"
  fi

  # Config-shaped files also receive literal credential-assignment checks.
  if is_env_assignment_file "$path"; then
    scan_env_assignment "$path" "$line"
  fi
}

# --- grep pre-filter patterns -------------------------------------------------
#
# Only lines matching one of these patterns reach scan_line. Each pattern is a
# strict superset of the corresponding scan_line trigger, so pre-filtering can
# never drop a line the full analysis would have flagged:
#
#   ^diff --git , ^+++    In the diff stream: file-section starts and +++ path
#                         headers, needed for path attribution. In a --unified=0
#                         stream a line starting "diff --git " can only be a
#                         real section start (added lines render as "+diff...",
#                         removed as "--diff...", and no context lines exist),
#                         so a "+++ b/..." header is accepted only directly
#                         after one; content that merely looks like a header
#                         (e.g. an added line "++ b/x") is skipped exactly like
#                         the original per-line reader skipped "+++"* lines.
#   <<<<<<< , =======, >>>>>>>   The only three line shapes that can advance,
#                         complete, or reset the merge-conflict state machine
#                         (case arms "<<<<<<< "*, exact "=======", ">>>>>>> "*).
#                         Lines matching none of them leave the state untouched,
#                         so skipping them cannot change conflict detection.
#   -----BEGIN            Required literal substring of the private-key regex.
#   (AKIA|ASIA)[A-Z0-9]{16} and the gh/github_pat/npm/xox token patterns are
#                         the detector regexes themselves (trivially supersets).
#   sk-[A-Za-z0-9][A-Za-z0-9_-]{31,}   Required by both API-token branches.
#   token|secret|password|api[-_]?key|private[-_]?key  (case-insensitive, env
#                         files only): every accepting arm of is_credential_key
#                         contains one of the stems token/secret/password/
#                         api_key/apikey/private_key/secret_key in the
#                         normalized key. Normalization only lowercases, maps
#                         "-" to "_", and inserts underscores; it never removes
#                         or reorders characters, so the raw line must contain
#                         the stem letters contiguously (any case) with at most
#                         one "-"/"_" inside the api/private+key stems. The
#                         same holds for Dockerfile ARG/ENV findings, which
#                         also require an is_credential_key key on the line.
#                         Placeholder values only suppress findings, so they
#                         need no pre-filter clause.
TOKEN_BODY_RE="-----BEGIN|${AWS_TOKEN_RE}|${GITHUB_LEGACY_TOKEN_RE}|${GITHUB_FINE_GRAINED_TOKEN_RE}|${NPM_TOKEN_RE}|${SLACK_TOKEN_RE}|${API_TOKEN_RE}"
STEM_BODY_RE='token|secret|password|api[-_]?key|private[-_]?key'
DIFF_GLOBAL_RE="^diff --git |^\\+\\+\\+ |^\\+<<<<<<< |^\\+={7}[[:cntrl:]]?\$|^\\+>>>>>>> |^\\+.*(${TOKEN_BODY_RE})"
DIFF_STEM_RE="^\\+.*(${STEM_BODY_RE})"
CONTENT_GLOBAL_RE="^<<<<<<< |^={7}[[:cntrl:]]?\$|^>>>>>>> |${TOKEN_BODY_RE}"
CONTENT_STEM_RE="${STEM_BODY_RE}"

# --- batched file gates -------------------------------------------------------

# Classifies full-content paths without loading them: 1=scannable, 2=oversized
# text, 3=binary, 4=unavailable, and 5=excluded symlink. Tracked/staged diffs do
# not use this cap because Git streams only added hunks for the user.
declare -A SCANNABLE=()
# Classify full-content paths before the scanner reads user-authored lines.
gate_scannable_files() {
  local -a batch=() chunk=() sizes=()
  local path size file_bytes i count total_lines sizes_output grep_output

  # Every full-content path gets an explicit admission or exclusion result.
  for path in "$@"; do
    # Untracked symlinks are deliberately not followed outside the user's repository.
    if [ -L "$path" ]; then
      SCANNABLE["$path"]=5
      continue
    fi
    # A path that vanished after Git inventory cannot count as scanned.
    if [ ! -f "$path" ] || [ ! -r "$path" ]; then
      SCANNABLE["$path"]=4
      continue
    fi
    # Newline paths need a quoted single-file probe instead of line-oriented batch output.
    if [[ "$path" == *$'\n'* ]]; then
      # A failed byte count means this unusual user path cannot be classified completely.
      if ! size="$(wc -c <"$path" 2>/dev/null)"; then
        mark_scan_incomplete "command" "byte-count command failed"
        return 1
      fi
      case "$size" in
        '' | *[!0-9[:space:]]*)
          mark_scan_incomplete "command" "byte-count command returned invalid output"
          return 1
          ;;
      esac
      # Empty user files contain no text findings but still count as completely inspected.
      if [ "$size" -eq 0 ]; then
        SCANNABLE["$path"]=1
        continue
      fi
      next_temp_path "binary-gate"
      grep_output="$TEMP_PATH"
      # The single-file text probe must complete before this unusual path can be classified.
      if ! capture_grep_output "$grep_output" "binary-content gate failed" -Iq '' "$path"; then
        return 1
      fi
      # Text above the cap is explicit incomplete coverage; binary uses its own reason.
      if [ "$GREP_STATUS" -eq 0 ] && [ "$size" -le "$MAX_FILE_BYTES" ]; then
        SCANNABLE["$path"]=1
      # Text above the cap remains an explicit full-content coverage gap.
      elif [ "$GREP_STATUS" -eq 0 ]; then
        SCANNABLE["$path"]=2
      else
        SCANNABLE["$path"]=3
      fi
      continue
    fi
    batch+=("$path")
  done
  set -- ${batch[@]+"${batch[@]}"}

  # Chunking keeps Windows command lines bounded while all paths retain a result.
  while (($# > 0)); do
    budget_check || return 0
    chunk=("${@:1:CHUNK_SIZE}")
    # Advance to the user's next bounded path batch without losing unusual names.
    if (($# > CHUNK_SIZE)); then shift "$CHUNK_SIZE"; else shift $#; fi

    next_temp_path "byte-count"
    sizes_output="$TEMP_PATH"
    # Every file in the batch needs a byte count before full-content admission.
    if ! wc -c -- "${chunk[@]}" >"$sizes_output" 2>/dev/null; then
      mark_scan_incomplete "command" "byte-count command failed"
      return 1
    fi
    sizes=()
    mapfile -t sizes <"$sizes_output"
    count=${#chunk[@]}
    total_lines=${#sizes[@]}
    # Expected output has one line per file plus one total only for multi-file batches.
    if { ((count == 1)) && ((total_lines == 1)); } || { ((count > 1)) && ((total_lines == count + 1)); }; then
      # Match each byte count back to the same user-visible path in the chunk.
      for ((i = 0; i < count; i++)); do
        # Invalid byte text cannot safely classify this path or its neighbors.
        if [[ ! "${sizes[i]}" =~ ^[[:space:]]*([0-9]+) ]]; then
          mark_scan_incomplete "command" "byte-count command returned invalid output"
          return 1
        fi
        file_bytes="${BASH_REMATCH[1]}"
        # Empty files are fully inspected without a content grep.
        if ((file_bytes == 0)); then
          SCANNABLE["${chunk[i]}"]=1
        # Non-empty files retain whether their whole content fits the user cap.
        elif ((file_bytes <= MAX_FILE_BYTES)); then
          SCANNABLE["${chunk[i]}"]=6
        else
          SCANNABLE["${chunk[i]}"]=7
        fi
      done
    else
      # Unexpected wc output shape (e.g. a file vanished mid-run): probe the
      # chunk per file only after marking the scan incomplete; shifted output
      # cannot safely prove that any neighboring path stayed within the cap.
      mark_scan_incomplete "command" "byte-count command returned invalid output"
      return 1
    fi

    # Promote non-empty text while preserving whether whole-file scanning fits the cap.
    next_temp_path "binary-gate"
    grep_output="$TEMP_PATH"
    # The batched text probe must complete before any non-empty path can be classified.
    if ! capture_grep_output "$grep_output" "binary-content gate failed" -IlZ -e '' -- "${chunk[@]}"; then
      return 1
    fi
    # Promote every text path returned by the binary gate to its final coverage class.
    while IFS= read -r -d '' path; do
      # A small text path can be scanned in full for the user.
      if [ "${SCANNABLE[$path]:-0}" = 6 ]; then
        SCANNABLE["$path"]=1
      # Oversized text stays distinct from binary so the UI explains the gap.
      elif [ "${SCANNABLE[$path]:-0}" = 7 ]; then
        SCANNABLE["$path"]=2
      fi
    done <"$grep_output"
    # Any non-empty path grep did not identify as text is binary content.
    for path in "${chunk[@]}"; do
      # Pending small or oversized paths were omitted because grep classified them as binary.
      if [ "${SCANNABLE[$path]:-0}" = 6 ] || [ "${SCANNABLE[$path]:-0}" = 7 ]; then
        SCANNABLE["$path"]=3
      fi
    done
  done
}

# --- diff-stream scanning -----------------------------------------------------

# Unquotes a C-style quoted git path ("caf\303\251.env" style) into UNQUOTED.
c_unquote_path() {
  local quoted="$1" out="" c oct
  quoted="${quoted#\"}"
  quoted="${quoted%\"}"
  # Decode every Git-escaped path byte so findings name the file the user recognizes.
  while [ -n "$quoted" ]; do
    c="${quoted:0:1}"
    # Ordinary path characters can be copied without escape decoding.
    if [ "$c" != "\\" ]; then
      out+="$c"
      quoted="${quoted:1}"
      continue
    fi
    c="${quoted:1:1}"
    case "$c" in
      [0-7])
        oct="${quoted:1:3}"
        oct="${oct%%[!0-7]*}"
        printf -v c '%b' "\\0$oct"
        out+="$c"
        quoted="${quoted:$((1 + ${#oct}))}"
        ;;
      a) out+=$'\a'; quoted="${quoted:2}" ;;
      b) out+=$'\b'; quoted="${quoted:2}" ;;
      f) out+=$'\f'; quoted="${quoted:2}" ;;
      n) out+=$'\n'; quoted="${quoted:2}" ;;
      r) out+=$'\r'; quoted="${quoted:2}" ;;
      t) out+=$'\t'; quoted="${quoted:2}" ;;
      v) out+=$'\v'; quoted="${quoted:2}" ;;
      *) out+="$c"; quoted="${quoted:2}" ;;
    esac
  done
  UNQUOTED="$out"
}

# Scan one bounded Git diff stream while preserving the user's file and line order.
# $1 is the stream file; empty added content produces no finding.
# Returns nonzero only when scanning cannot complete; findings feed the final verdict.
scan_diff_stream() {
  local stream="$1"
  local -a global_hits=() stem_hits=()
  local ai=0 bi=0 an bn hit line from_global
  local cur_path="" cur_active=0 cur_env=0 expect_header=0 rest
  local global_output stem_output

  # -a forces text handling of odd bytes; -U keeps CR bytes at end of line
  # (Windows grep builds strip them in text mode, which would alter the line
  # content scan_line sees compared to the original `read -r` loop).
  next_temp_path "diff-global-hits"
  global_output="$TEMP_PATH"
  # Global candidates preserve path headers and every high-confidence detector family.
  if ! capture_grep_output "$global_output" "diff candidate grep failed" -aUnE "$DIFF_GLOBAL_RE" "$stream"; then
    return 1
  fi
  next_temp_path "diff-stem-hits"
  stem_output="$TEMP_PATH"
  # Config-key stems add assignment candidates without widening source-file guessing.
  if ! capture_grep_output "$stem_output" "diff candidate grep failed" -iaUnE "$DIFF_STEM_RE" "$stream"; then
    return 1
  fi
  mapfile -t global_hits <"$global_output"
  mapfile -t stem_hits <"$stem_output"

  # Merge both ordered candidate streams so conflict state follows the user's line order.
  while ((ai < ${#global_hits[@]} || bi < ${#stem_hits[@]})); do
    budget_check || return 0
    # A remaining global candidate exposes its original diff line number.
    if ((ai < ${#global_hits[@]})); then an="${global_hits[ai]%%:*}"; else an=""; fi
    # A remaining config-stem candidate exposes its original diff line number.
    if ((bi < ${#stem_hits[@]})); then bn="${stem_hits[bi]%%:*}"; else bn=""; fi

    from_global=1
    # Select the earlier candidate and consume duplicates once from both streams.
    if [ -z "$an" ]; then
      from_global=0
      hit="${stem_hits[bi]}"
      bi=$((bi + 1))
    # The earlier global detector candidate keeps its original user line order.
    elif [ -z "$bn" ] || ((an < bn)); then
      hit="${global_hits[ai]}"
      ai=$((ai + 1))
    # One line matched both candidate sets, so scan it only once.
    elif ((an == bn)); then
      hit="${global_hits[ai]}"
      ai=$((ai + 1))
      bi=$((bi + 1))
    else
      from_global=0
      hit="${stem_hits[bi]}"
      bi=$((bi + 1))
    fi
    line="${hit#*:}"

    # A real Git section header resets path attribution before added user text.
    if ((from_global)) && [[ "$line" == "diff --git "* ]]; then
      expect_header=1
      cur_active=0
      continue
    fi
    # Only the destination header immediately after a section selects a user path.
    if ((from_global && expect_header)) && [[ "$line" == "+++ "* ]]; then
      expect_header=0
      rest="${line#+++ }"
      # A deleted file has no added content for the safety scanner to inspect.
      if [ "$rest" = "/dev/null" ]; then
        cur_active=0
        continue
      fi
      # Quoted Git paths must be decoded before the user sees a finding.
      if [[ "$rest" == \"* ]]; then
        c_unquote_path "$rest"
        rest="$UNQUOTED"
      else
        rest="${rest%$'\t'}"
      fi
      rest="${rest#b/}"
      cur_path="$rest"
      cur_active=1
      cur_env=0
      # Config-shaped files admit the additional credential-key candidate stream.
      if is_env_assignment_file "$cur_path"; then cur_env=1; fi
      reset_merge_conflict_scan "$cur_path"
      # Completion accounting advances once each selected user file begins scanning.
      if ((DIFF_FILES_DONE >= 0)); then DIFF_FILES_DONE=$((DIFF_FILES_DONE + 1)); fi
      continue
    fi

    ((cur_active)) || continue
    case "$line" in
      "+++"* | "---"* | "@@"*) continue ;;
      +*) ;;
      *) continue ;;
    esac
    # Global detector hits and admitted config stems both reach the full line scanner.
    if ((from_global)) || ((cur_env)); then
      scan_line "$cur_path" "${line#+}"
    fi
  done
}

# Runs one batched --unified=0 diff over a chunked path list and scans the
# stream. Prefix/quotepath settings are pinned so header parsing stays stable
# under any user diff config; content and path selection semantics match the
# original per-path `git diff` calls (same pathspec set, same flags).
DIFF_FILES_DONE=0
# Stream one worktree or staged path batch and preserve per-path user coverage.
run_diff_batch() {
  local mode="$1"
  shift
  local -a chunk=()
  local binary_inventory
  local binary_path
  local binary_record
  local stream

  # Each chunk streams both coverage metadata and added text without loading full files.
  while (($# > 0)); do
    budget_check || return 0
    chunk=("${@:1:CHUNK_SIZE}")
    # Advance to the user's next bounded diff batch without losing unusual names.
    if (($# > CHUNK_SIZE)); then shift "$CHUNK_SIZE"; else shift $#; fi
    next_temp_path "binary-inventory"
    binary_inventory="$TEMP_PATH"
    # Staged users need coverage metadata from the index snapshot.
    if [ "$mode" = "cached" ]; then
      # A failed staged inventory leaves the coding agent unable to claim complete coverage.
      if ! git -c core.quotepath=off \
        diff --cached --no-ext-diff --no-color --numstat --no-renames --diff-filter=ACMR -z -- "${chunk[@]}" \
        >"$binary_inventory" 2>/dev/null; then
        mark_scan_incomplete "command" "Git binary inventory failed"
        return 1
      fi
    # Worktree users need the same metadata against their committed baseline.
    else
      # A failed worktree inventory leaves the coding agent unable to claim complete coverage.
      if ! git -c core.quotepath=off \
        diff --no-ext-diff --no-color --numstat --no-renames --diff-filter=ACMR -z HEAD -- "${chunk[@]}" \
        >"$binary_inventory" 2>/dev/null; then
        mark_scan_incomplete "command" "Git binary inventory failed"
        return 1
      fi
    fi
    # Binary paths have no added text hunks, so record their missing coverage explicitly.
    while IFS= read -r -d '' binary_record; do
      case "$binary_record" in
        $'-\t-\t'*)
          binary_path="${binary_record#$'-\t-\t'}"
          mark_coverage_gap "$binary_path" "binary changed path not scanned"
          ;;
      esac
    done <"$binary_inventory"

    next_temp_path "diff-stream"
    stream="$TEMP_PATH"
    # Staged and worktree snapshots need different Git baselines but identical scanning.
    if [ "$mode" = "cached" ]; then
      # The staged added-hunk stream must complete before index content can pass.
      if ! git -c core.quotepath=off -c diff.noprefix=false -c diff.mnemonicprefix=false \
        -c diff.srcprefix=a/ -c diff.dstprefix=b/ \
        diff --cached --no-ext-diff --no-color --unified=0 -- "${chunk[@]}" \
        >"$stream" 2>/dev/null; then
        mark_scan_incomplete "command" "Git diff command failed"
        return 1
      fi
    else
      # The worktree added-hunk stream must complete before tracked content can pass.
      if ! git -c core.quotepath=off -c diff.noprefix=false -c diff.mnemonicprefix=false \
        -c diff.srcprefix=a/ -c diff.dstprefix=b/ \
        diff --no-ext-diff --no-color --unified=0 HEAD -- "${chunk[@]}" \
        >"$stream" 2>/dev/null; then
        mark_scan_incomplete "command" "Git diff command failed"
        return 1
      fi
    fi
    scan_diff_stream "$stream" || return 1
  done
}

# --- full-content scanning (untracked and unborn-HEAD files) -------------------

# Scan gated whole files so new user content receives the same ordered detectors.
# Arguments are paths; an empty list is clean because there is no declared content.
# Returns nonzero only when scanning cannot complete; findings feed the final verdict.
scan_content_files() {
  local -a files=("$@") env_files=() g_path=() g_ln=() g_line=() s_path=() s_ln=() s_line=()
  local -A file_order=()
  local -a chunk=()
  local path rest i gi si cur="" grep_output

  ((${#files[@]} > 0)) || return 0
  # Record stable file order and the subset that admits config assignment checks.
  for ((i = 0; i < ${#files[@]}; i++)); do
    file_order["${files[i]}"]=$i
    # Only config-shaped user files need the credential-stem candidate stream.
    if is_env_assignment_file "${files[i]}"; then
      env_files+=("${files[i]}")
    fi
  done

  set -- "${files[@]}"
  # Read global detector candidates from each bounded full-content batch.
  while (($# > 0)); do
    budget_check || return 0
    chunk=("${@:1:CHUNK_SIZE}")
    # Advance to the user's next bounded content batch without losing unusual names.
    if (($# > CHUNK_SIZE)); then shift "$CHUNK_SIZE"; else shift $#; fi
    next_temp_path "content-global-hits"
    grep_output="$TEMP_PATH"
    # Candidate selection must finish before any file in this batch can pass.
    if ! capture_grep_output "$grep_output" "content candidate grep failed" -aUHnZE --null -e "$CONTENT_GLOBAL_RE" -- "${chunk[@]}"; then
      return 1
    fi
    # Preserve each path, line number, and line body for ordered user-facing scanning.
    while IFS= read -r -d '' path && IFS= read -r rest; do
      g_path+=("$path")
      g_ln+=("${rest%%:*}")
      g_line+=("${rest#*:}")
    done <"$grep_output"
  done

  set -- ${env_files[@]+"${env_files[@]}"}
  # Read config-stem candidates from each bounded admitted-file batch.
  while (($# > 0)); do
    budget_check || return 0
    chunk=("${@:1:CHUNK_SIZE}")
    # Advance to the user's next bounded config batch without losing unusual names.
    if (($# > CHUNK_SIZE)); then shift "$CHUNK_SIZE"; else shift $#; fi
    next_temp_path "content-stem-hits"
    grep_output="$TEMP_PATH"
    # Config candidate selection must finish before these files can pass.
    if ! capture_grep_output "$grep_output" "content candidate grep failed" -iaUHnZE --null -e "$CONTENT_STEM_RE" -- "${chunk[@]}"; then
      return 1
    fi
    # Preserve each config path, line number, and line body for ordered scanning.
    while IFS= read -r -d '' path && IFS= read -r rest; do
      s_path+=("$path")
      s_ln+=("${rest%%:*}")
      s_line+=("${rest#*:}")
    done <"$grep_output"
  done

  gi=0
  si=0
  # Merge global and config candidates in the order the user wrote them.
  while ((gi < ${#g_path[@]} || si < ${#s_path[@]})); do
    budget_check || return 0
    local g_ok=0 s_ok=0 g_key=0 s_key=0 pick_path pick_line
    # A remaining global candidate gets a sortable file-and-line key.
    if ((gi < ${#g_path[@]})); then
      g_ok=1
      g_key=$((${file_order[${g_path[gi]}]:-0} * 10000000 + g_ln[gi]))
    fi
    # A remaining config candidate gets the same sortable file-and-line key.
    if ((si < ${#s_path[@]})); then
      s_ok=1
      s_key=$((${file_order[${s_path[si]}]:-0} * 10000000 + s_ln[si]))
    fi
    # Select the earlier candidate and consume duplicate matches once.
    if ((g_ok && s_ok && g_key == s_key)); then
      pick_path="${g_path[gi]}"
      pick_line="${g_line[gi]}"
      gi=$((gi + 1))
      si=$((si + 1))
    # A remaining or earlier global candidate is the next user line to scan.
    elif ((g_ok)) && { ((!s_ok)) || ((g_key < s_key)); }; then
      pick_path="${g_path[gi]}"
      pick_line="${g_line[gi]}"
      gi=$((gi + 1))
    else
      pick_path="${s_path[si]}"
      pick_line="${s_line[si]}"
      si=$((si + 1))
    fi
    # A new user file resets conflict-marker state before its first candidate line.
    if [ "$pick_path" != "$cur" ]; then
      cur="$pick_path"
      reset_merge_conflict_scan "$cur"
    fi
    scan_line "$pick_path" "$pick_line"
  done
}

# --- path-set collection ------------------------------------------------------

COLLECTED=()
# Collect a NUL-delimited Git path inventory without losing unusual user filenames.
collect_z() {
  local path output
  COLLECTED=()
  next_temp_path "path-inventory"
  output="$TEMP_PATH"
  # A failed Git inventory means the user's declared changed-path set is unknown.
  if ! "$@" >"$output" 2>/dev/null; then
    mark_scan_incomplete "command" "Git path inventory failed"
    return 1
  fi
  # Preserve every unusual path exactly as Git emitted it.
  while IFS= read -r -d '' path; do
    COLLECTED+=("$path")
  done <"$output"
}

# Run the optimized scan and return the coding agent's final Stop decision.
main() {
  local root
  local WORKDIR
  local head_status
  # Without a Git root, the hook cannot identify the project changes for this turn.
  if ! root="$(repo_root)" || [ -z "$root" ]; then
    post_turn_result_detail="The selected Git repository root could not be opened"
    printf 'post-turn-safety: scan incomplete (git repository root unavailable).\n' >&2
    return 2
  fi

  cd "$root" 2>/dev/null || {
    post_turn_result_detail="The selected Git repository root could not be entered"
    printf 'post-turn-safety: scan incomplete (repository root cannot be entered).\n' >&2
    return 2
  }

  WORKDIR="$(mktemp -d 2>/dev/null)" || WORKDIR=""
  # Temporary scan output is required before Git content can be inspected safely.
  if [ -z "$WORKDIR" ]; then
    post_turn_result_detail="A temporary safety-scan workspace could not be created"
    printf 'post-turn-safety: scan incomplete (scan workspace unavailable).\n' >&2
    finish_infrastructure_failure "$root" "native:scan workspace unavailable"
    return $?
  fi
  # shellcheck disable=SC2064
  trap "rm -rf '$WORKDIR'" EXIT
  post_turn_result_records_path="$WORKDIR/hook-result-records"

  local head_present=0
  has_head
  head_status=$?
  # A committed baseline lets the native path stream only changed hunks.
  if [ "$head_status" -eq 0 ]; then
    head_present=1
  # Exit 128 means no first commit; other failures leave baseline status unknown.
  elif [ "$head_status" -ne 128 ]; then
    mark_scan_incomplete "command" "Git HEAD inspection failed"
  fi

  local -a worktree_paths=() cached_paths=() untracked_paths=()
  # Worktree inventory runs first so later staged deduplication knows what was scanned.
  if ((BAIL == 0)); then
    # A committed baseline lets tracked paths bypass whole-file admission safely.
    if ((head_present)); then
      collect_z git diff --name-only -z --diff-filter=ACMR HEAD --
    else
      collect_z git ls-files -z
    fi
    worktree_paths=(${COLLECTED[@]+"${COLLECTED[@]}"})
  fi
  # Staged inventory runs only while the project path set remains trustworthy.
  if ((BAIL == 0)); then
    collect_z git diff --cached --name-only -z --diff-filter=ACMR --
    cached_paths=(${COLLECTED[@]+"${COLLECTED[@]}"})
  fi
  # Non-ignored untracked inventory completes the content the user could commit.
  if ((BAIL == 0)); then
    collect_z git ls-files --others --exclude-standard -z
    untracked_paths=(${COLLECTED[@]+"${COLLECTED[@]}"})
  fi

  # Fast exit: nothing changed, staged, or untracked, so there is nothing to
  # scan and no batch work to set up.
  if ((BAIL == 0 && ${#worktree_paths[@]} == 0 && ${#cached_paths[@]} == 0 && ${#untracked_paths[@]} == 0)); then
    clear_stop_reentry_state "$root" >/dev/null 2>&1
    return 0
  fi

  PENDING_FILES=$((${#worktree_paths[@]} + ${#cached_paths[@]} + ${#untracked_paths[@]}))

  # Full-content gates apply to untracked files and unborn-HEAD worktree files;
  # ordinary tracked changes stream from Git diffs without a whole-file cap.
  if ((BAIL == 0)); then
    # A committed baseline limits full-content gates to untracked paths.
    if ((head_present)); then
      gate_scannable_files ${untracked_paths[@]+"${untracked_paths[@]}"}
    else
      gate_scannable_files ${worktree_paths[@]+"${worktree_paths[@]}"} ${untracked_paths[@]+"${untracked_paths[@]}"}
    fi
  fi

  # Pass 1: tracked changes (worktree vs HEAD), or full index contents when
  # HEAD is unborn. Mirrors scan_tracked_changes/scan_worktree_diff_file.
  local -a pass1=()
  local -A pass1_scanned=()
  local path
  # A normal repository can stream every tracked path; an unborn repository needs full-content admission.
  for path in ${worktree_paths[@]+"${worktree_paths[@]}"}; do
    # Stream normal tracked paths or admit complete unborn text for the user.
    if ((head_present)) || [ "${SCANNABLE[$path]:-0}" = 1 ]; then
      pass1+=("$path")
      pass1_scanned["$path"]=1
    # Oversized unborn content has no trusted baseline from which to stream added hunks.
    elif [ "${SCANNABLE[$path]:-0}" = 2 ]; then
      mark_coverage_gap "$path" "oversized unborn worktree text not scanned"
    # Binary unborn content has no text stream the user-facing detectors can inspect.
    elif [ "${SCANNABLE[$path]:-0}" = 3 ]; then
      mark_coverage_gap "$path" "binary unborn worktree path not scanned"
    # A vanished unborn path cannot count toward complete user coverage.
    elif [ "${SCANNABLE[$path]:-0}" = 4 ]; then
      mark_coverage_gap "$path" "unborn worktree path unavailable"
    fi
  done
  # The tracked pass starts only while time and infrastructure still permit complete work.
  if budget_check; then
    # A committed baseline uses added hunks; an unborn repository uses admitted full content.
    if ((head_present)); then
      DIFF_FILES_DONE=0
      run_diff_batch worktree ${pass1[@]+"${pass1[@]}"}
      PENDING_FILES=$((PENDING_FILES - (BAIL ? DIFF_FILES_DONE : ${#worktree_paths[@]})))
    else
      scan_content_files ${pass1[@]+"${pass1[@]}"}
      # Completion accounting advances only after the unborn full-content scan finishes.
      if ((BAIL == 0)); then PENDING_FILES=$((PENDING_FILES - ${#worktree_paths[@]})); fi
    fi
  fi

  # Pass 2: staged changes. When the index entry equals the worktree file
  # (path absent from `git diff --name-only`) and pass 1 scanned that path,
  # the --cached diff is byte-identical to the pass-1 diff, so every finding it
  # could produce was already reported (report_finding dedupes on path+family);
  # such paths are safely skipped. Paths whose index differs from the worktree
  # (including staged-then-reverted and staged-then-edited states) are always
  # scanned, as is everything when HEAD is unborn.
  if ((BAIL == 0)) && ((${#cached_paths[@]} > 0)); then
    local -A dirty_vs_index=()
    # A committed baseline can skip staged content already identical to pass one.
    if ((head_present)); then
      collect_z git diff --name-only -z --
      # Only a complete index/worktree comparison can authorize staged deduplication.
      if ((BAIL == 0)); then
        # Record every path whose worktree differs from the staged snapshot.
        for path in ${COLLECTED[@]+"${COLLECTED[@]}"}; do
          dirty_vs_index["$path"]=1
        done
      fi
    fi
    local -a cached_candidates=()
    # Candidate selection runs only after staged deduplication evidence is complete.
    if ((BAIL == 0)); then
      # Inspect each staged path independently so index-only user content stays covered.
      for path in ${cached_paths[@]+"${cached_paths[@]}"}; do
        # Unborn, dirty, or unscanned paths need their staged added hunks inspected.
        if ((head_present == 0)) || [ -n "${dirty_vs_index[$path]:-}" ] || [ -z "${pass1_scanned[$path]:-}" ]; then
          cached_candidates+=("$path")
        fi
      done
    fi

    # Git streams only added index hunks, so full staged blob size never suppresses a scan.
    local -a cached_scan=(${cached_candidates[@]+"${cached_candidates[@]}"})
    # The staged diff starts only while earlier user-content coverage remains complete.
    if ((BAIL == 0)); then
      DIFF_FILES_DONE=0
      run_diff_batch cached ${cached_scan[@]+"${cached_scan[@]}"}
      PENDING_FILES=$((PENDING_FILES - (BAIL ? DIFF_FILES_DONE : ${#cached_paths[@]})))
    fi
  fi

  # Untracked pass: full-content scan of non-ignored untracked files, mirroring
  # scan_untracked_changes/scan_untracked_file.
  if ((BAIL == 0)); then
    local -a untracked_scan=()
    # Each non-ignored untracked path must scan in full or name its coverage gap.
    for path in ${untracked_paths[@]+"${untracked_paths[@]}"}; do
      # Admitted text can receive every high-confidence user-facing detector.
      if [ "${SCANNABLE[$path]:-0}" = 1 ]; then
        untracked_scan+=("$path")
      # Whole oversized untracked content cannot be compared with a committed baseline.
      elif [ "${SCANNABLE[$path]:-0}" = 2 ]; then
        mark_coverage_gap "$path" "oversized untracked text not scanned"
      # Binary untracked content cannot reach the text detectors.
      elif [ "${SCANNABLE[$path]:-0}" = 3 ]; then
        mark_coverage_gap "$path" "binary untracked path not scanned"
      # A vanished untracked path cannot count toward complete user coverage.
      elif [ "${SCANNABLE[$path]:-0}" = 4 ]; then
        mark_coverage_gap "$path" "untracked path unavailable"
      fi
    done
    scan_content_files ${untracked_scan[@]+"${untracked_scan[@]}"}
    # A complete final content scan closes all remaining path accounting.
    if ((BAIL == 0)); then PENDING_FILES=0; fi
  fi

  # An incomplete native scan must block instead of showing a clean turn.
  if ((BAIL)); then
    # Budget failures name unscanned files; command failures name the failed operation.
    if [ "$INCOMPLETE_KIND" = "budget" ]; then
      ((PENDING_FILES > 0)) || PENDING_FILES=1
      printf 'post-turn-safety: scan incomplete, %s file(s) unscanned (budget %ss exceeded; raise GOAT_FLOW_POST_TURN_SAFETY_MAX_SECONDS to scan more).\n' "$PENDING_FILES" "$MAX_SECONDS" >&2
    else
      printf 'post-turn-safety: scan incomplete (%s).\n' "$INCOMPLETE_REASON" >&2
    fi
  fi

  # Every skipped declared path gets a concise relative-path explanation for the user.
  if ((COVERAGE_GAP)); then
    local coverage_gap_message
    # Report every distinct path the user must remove, reduce, or inspect separately.
    for coverage_gap_message in "${COVERAGE_GAP_MESSAGES[@]}"; do
      printf 'post-turn-safety: scan incomplete (%s).\n' "$coverage_gap_message" >&2
    done
  fi

  # Findings always block, even when another scanner condition also became incomplete.
  if [ "$findings" -gt 0 ]; then
    clear_stop_reentry_state "$root" >/dev/null 2>&1
    # The cap hides duplicate detail, then reports how many user actions remain.
    if [ "$findings" -gt "$MAX_FINDINGS" ]; then
      printf 'post-turn-safety: %s additional finding(s) hidden by output cap.\n' "$((findings - MAX_FINDINGS))" >&2
    fi
    printf 'post-turn-safety: fix or remove the flagged changed content before stopping.\n' >&2
    return 2
  fi

  # Incomplete content coverage must block every Stop replay, even when unchanged.
  if ((COVERAGE_GAP)); then
    clear_stop_reentry_state "$root" >/dev/null 2>&1
    return 2
  fi

  # Budget failures block; exact command failures alone may use bounded re-entry.
  if ((BAIL)); then
    # Only a scanner command failure can end one exact repeated provider cycle.
    if [ "$INCOMPLETE_KIND" = "command" ]; then
      finish_infrastructure_failure "$root" "native:$INCOMPLETE_REASON"
      return $?
    fi
    clear_stop_reentry_state "$root" >/dev/null 2>&1
    return 2
  fi

  clear_stop_reentry_state "$root" >/dev/null 2>&1
  return 0
}

finish_post_turn_scan "native" main "$@"

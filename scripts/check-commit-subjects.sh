#!/usr/bin/env bash
# Checks deterministic rules from docs/coding-standards/git-commit-message.md.
#
# Why this exists: the subject standard is stated in the hot path (CLAUDE.md
# "Commit Messages") and in the canonical doc, but the `commit-guidance`
# harness check only asserts that the doc EXISTS. Nothing measured whether
# commits follow it, and they drifted - at the time this gate was added, 25 of
# the last 40 subjects exceeded 72 characters and 9 used multi-scope forms.
#
# Scope: commits after GRANDFATHER_BASE only. Existing history is not rewritten
# (agents never rewrite published history, and the user owns commits), so a
# whole-history gate would fail permanently and get switched off. Everything
# committed from the baseline forward must comply.
#
# Override the range with COMMIT_SUBJECT_BASE=<ref> when auditing a different span.

set -uo pipefail

# HEAD of dev when this gate landed. Commits at or before it are historical.
GRANDFATHER_BASE="${COMMIT_SUBJECT_BASE:-2d106ea07d1b33dae3042059f4cb295e47f151e2}"

TYPES='feat|fix|docs|refactor|test|perf|build|ci|chore|security|revert'
WEAK_VERBS='enhance|enhances|enhanced|improve|improves|improved|streamline|streamlines|streamlined|clarify|clarifies|clarified|update|updates|updated|tweak|tweaks|tweaked|polish|polishes|polished'
PAST_TENSE_VERBS='added|changed|created|deleted|documented|fixed|implemented|moved|refactored|removed|renamed|replaced|tested'

if ! git rev-parse --verify --quiet "$GRANDFATHER_BASE" >/dev/null; then
    echo "SKIP: baseline $GRANDFATHER_BASE not present in this checkout"
    exit 0
fi

if ! git merge-base --is-ancestor "$GRANDFATHER_BASE" HEAD 2>/dev/null; then
    echo "SKIP: baseline $GRANDFATHER_BASE is not an ancestor of HEAD"
    exit 0
fi

violations=0
checked=0
head_sha=$(git rev-parse --verify HEAD)
current_branch="${GITHUB_HEAD_REF:-}"
if [[ -z "$current_branch" ]]; then
    current_branch=$(git symbolic-ref --quiet --short HEAD 2>/dev/null || true)
fi
required_issue_prefix=""
if [[ "$current_branch" =~ ^feat/([0-9]+)$ ]]; then
    required_issue_prefix="#${BASH_REMATCH[1]} "
fi

report() {
    printf '  %s: %s\n' "$1" "$2"
    violations=$((violations + 1))
}

# --no-merges: merge subjects ("Merge pull request #56 from ...") are generated
# by the forge, not authored against this standard. Process substitution keeps
# counters in this shell and works on stock macOS Bash 3.2, unlike `mapfile`.
while IFS= read -r sha; do
    checked=$((checked + 1))
    subject=$(git log -1 --format='%s' "$sha")
    short="${sha:0:8}"

    # Only HEAD has reliable current-branch provenance. Older commits may have
    # reached this branch through a merge, so their original prefix remains
    # syntax-checked without guessing which branch authorized it.
    if [[ "$sha" == "$head_sha" && -n "$current_branch" ]]; then
        if [[ -n "$required_issue_prefix" ]]; then
            if [[ "$subject" != "$required_issue_prefix"* ]]; then
                report "$short" "HEAD prefix must be ${required_issue_prefix% } on branch $current_branch: $subject"
            fi
        elif [[ "$subject" =~ ^(#[0-9]+|[A-Z][A-Z0-9]+-[0-9]+)[[:space:]] ]]; then
            report "$short" "HEAD prefix is not authorized on branch $current_branch: $subject"
        fi
    fi

    if [[ "$subject" == *'**'* ]]; then
        report "$short" "subject contains literal '**' markdown emphasis: $subject"
    fi

    if [[ ${#subject} -gt 72 ]]; then
        report "$short" "subject is ${#subject} chars (limit 72): $subject"
    fi

    if [[ "$subject" == *. ]]; then
        report "$short" "subject ends with a period: $subject"
    fi

    # Strip an allowed real issue/ticket prefix before checking conventional shape.
    stripped=$(printf '%s' "$subject" | sed -E 's/^(#[0-9]+|[A-Z][A-Z0-9]+-[0-9]+) //')

    if ! printf '%s' "$stripped" | grep -qE "^($TYPES)(\([^)]+\))?: .+"; then
        report "$short" "subject is not 'type(scope): subject': $subject"
        continue
    fi

    if printf '%s' "$stripped" | grep -qE "^($TYPES)\([^)]*,"; then
        report "$short" "subject uses multiple scopes (one scope per message): $subject"
    fi

    body_text=${stripped#*: }
    if printf '%s' "$body_text" | grep -qiE "^($PAST_TENSE_VERBS)\b"; then
        report "$short" "subject must lead with an imperative verb: $subject"
    elif printf '%s' "$body_text" | grep -qiE "^($WEAK_VERBS)\b"; then
        report "$short" "subject leads with a weak verb - name the observable change: $subject"
    fi
done < <(git rev-list --no-merges "$GRANDFATHER_BASE..HEAD")

if [[ "$checked" -eq 0 ]]; then
    echo "PASS: no commits after baseline to check"
    exit 0
fi

if [[ "$violations" -gt 0 ]]; then
    echo "FAIL: $violations commit-subject violation(s) across $checked commit(s) after $GRANDFATHER_BASE"
    echo "Standard: docs/coding-standards/git-commit-message.md"
    exit 1
fi

echo "PASS: $checked commit subject(s) satisfy the checked rules"
exit 0

#!/usr/bin/env bash

# check-path-integrity.sh
#
# Purpose:
#   Validates that all internal path references in installed goat-flow
#   output resolve to real files. Catches the R9 regression class where
#   framework-local paths leak into installed skills.
#
# Usage:
#   bash scripts/check-path-integrity.sh [project-root]
#   Default: current directory
#
# Exit:
#   0 = all paths resolve, 1 = dead or invalid references found

set -uo pipefail

root="${1:-.}"
errors=0

err() { echo "FAIL: $1" >&2; errors=$((errors + 1)); }

# ── 1. workflow/ paths in installed skills are INVALID ──────────────
# The R9 regression was exactly this: workflow/templates/* leaked into
# installed skills. In the goat-flow repo, those paths resolve - so a
# naive "does it exist?" check would miss the bug. Any workflow/ path
# in installed skill files is an error regardless of resolution.
for agent_dir in ".claude/skills" ".agents/skills"; do
    dir="${root}/${agent_dir}"
    [[ -d "$dir" ]] || continue
    while IFS= read -r match; do
        file="${match%%:*}"
        err "${file}: contains framework-local workflow/ path (should use .goat-flow/ paths): ${match#*:}"
    done < <(grep -rn 'workflow/' "${dir}"/goat-*/SKILL.md "${dir}"/goat/SKILL.md 2>/dev/null | grep -Ev ':[0-9]+:[[:space:]]*#' || true)
done

# ── 2. .goat-flow/ paths in installed skills must resolve ───────────
for agent_dir in ".claude/skills" ".agents/skills"; do
    dir="${root}/${agent_dir}"
    [[ -d "$dir" ]] || continue
    while IFS= read -r ref_path; do
        # Strip backticks and trailing punctuation
        clean=$(echo "$ref_path" | sed 's/[`'"'"'",;)]*$//' | sed 's/^[`'"'"'"]//')
        if [[ "$clean" == .goat-flow/* ]] && [[ ! -e "${root}/${clean}" ]]; then
            err "Installed skill references missing path: ${clean}"
        fi
    done < <(grep -rohE '\.goat-flow/[a-zA-Z0-9_./-]+' "${dir}"/goat-*/SKILL.md "${dir}"/goat/SKILL.md 2>/dev/null | sort -u || true)
done

# ── 3. Instruction file router table paths must exist ───────────────
for ifile in CLAUDE.md AGENTS.md GEMINI.md; do
    filepath="${root}/${ifile}"
    [[ -f "$filepath" ]] || continue
    in_router=0
    while IFS= read -r line; do
        if echo "$line" | grep -qi "Router Table\|## Router"; then
            in_router=1; continue
        fi
        if [[ "$in_router" -eq 1 ]] && echo "$line" | grep -q "^##"; then
            break
        fi
        if [[ "$in_router" -eq 1 ]]; then
            # Extract backtick-quoted paths from table rows (all paths, not just dot-prefixed)
            # shellcheck disable=SC2016
            ref_paths=$(echo "$line" | grep -oE '[`][^`]+[`]' | tr -d '`' | grep -vE '^\(|^goat' || true)
            for ref_path in $ref_paths; do
                if [[ ! -e "${root}/${ref_path}" ]]; then
                    err "${ifile} router table: path does not exist: ${ref_path}"
                fi
            done
        fi
    done < "$filepath"
done

# ── 4. config.yaml path fields must exist (if populated) ────────────
config="${root}/.goat-flow/config.yaml"
if [[ -f "$config" ]]; then
    for field in footguns lessons decisions tasks logs; do
        path_val=$(grep -A1 "^${field}:" "$config" 2>/dev/null | grep 'path:' | sed 's/.*path:\s*//' | tr -d '"'"'" || true)
        if [[ -n "$path_val" ]] && [[ ! -e "${root}/${path_val}" ]]; then
            err "config.yaml ${field}.path does not exist: ${path_val}"
        fi
    done
fi

# ── 5. config.yaml toolchain script paths must exist ────────────────
if [[ -f "$config" ]]; then
    while IFS= read -r cmd; do
        # Extract the command/script path (first token after bash/sh/node)
        script=$(echo "$cmd" | sed 's/^\s*-\s*//' | sed 's/^bash\s\+//' | sed 's/^sh\s\+//' | sed 's/^node\s\+//' | awk '{print $1}')
        if [[ "$script" == scripts/* ]] && [[ ! -f "${root}/${script}" ]]; then
            err "config.yaml toolchain references missing script: ${script}"
        fi
    done < <(sed -n '/^toolchain:/,/^[a-z]/p' "$config" | grep '^\s*-' || true)
fi

# ── 6. Hook files in settings/config must exist and be executable ───
for settings in ".claude/settings.json" ".gemini/settings.json" ".codex/hooks.json"; do
    sfile="${root}/${settings}"
    [[ -f "$sfile" ]] || continue
    while IFS= read -r hook_path; do
        [[ -z "$hook_path" ]] && continue
        if [[ ! -f "${root}/${hook_path}" ]]; then
            err "${settings}: hook file does not exist: ${hook_path}"
        elif [[ ! -x "${root}/${hook_path}" ]]; then
            err "${settings}: hook file not executable: ${hook_path}"
        fi
    done < <(grep -oE '\.[a-z]+/hooks/[a-zA-Z0-9_-]+\.sh' "$sfile" 2>/dev/null | sort -u || true)
done

# ── 7. No stale skill names ─────────────────────────────────────────
stale_skills="goat-preflight goat-research goat-audit goat-investigate goat-onboard goat-reflect goat-resume goat-context goat-simplify goat-refactor"
for agent_dir in ".claude/skills" ".agents/skills"; do
    dir="${root}/${agent_dir}"
    [[ -d "$dir" ]] || continue
    for stale in $stale_skills; do
        if [[ -d "${dir}/${stale}" ]]; then
            err "Stale skill directory: ${agent_dir}/${stale}"
        fi
    done
done

# ── Result ──────────────────────────────────────────────────────────
if [[ "$errors" -gt 0 ]]; then
    echo "Path integrity: ${errors} error(s) found" >&2
    exit 1
fi
echo "Path integrity: all references resolve"
exit 0

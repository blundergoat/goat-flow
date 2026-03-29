# Bash Coding Standards

Reference for generating `ai/instructions/backend.md` or project-level shell
script guidelines. Use this when shell is a primary implementation surface or a
significant automation/runtime layer, not just because a non-shell repo has a
few maintenance scripts.

## Script Structure

- Start every script with `#!/usr/bin/env bash` and `set -euo pipefail`.
- Organize logic into functions. Keep the top-level body to argument parsing and function calls.
- Use `main` as the entry point and call it at the bottom: `main "$@"`.

```bash
#!/usr/bin/env bash
set -euo pipefail

# DO — structured with functions and main entry
usage() { printf "Usage: %s <config-file>\n" "$0" >&2; }

validate_config() {
  local config_file="$1"
  [[ -f "$config_file" ]] || { printf "File not found: %s\n" "$config_file" >&2; return 1; }
}

main() {
  [[ $# -ge 1 ]] || { usage; exit 1; }
  validate_config "$1"
  # ...
}

main "$@"

# DON'T — flat script with no functions, no strict mode
config=$1
if [ ! -f $config ]; then echo "not found"; fi
```

## Variables

- Always quote variables: `"$var"`, `"${array[@]}"`. Unquoted variables split on whitespace and expand globs.
- Use `${var:-default}` for defaults. Use `${var:?error message}` to fail on unset.
- Declare variables `local` inside functions. Never leak globals from helper functions.

```bash
# DO — quoted, local, with defaults
process_file() {
  local input_file="$1"
  local output_dir="${2:-./out}"
  mkdir -p "$output_dir"
  cp "$input_file" "$output_dir/"
}

# DON'T — unquoted, global, no defaults
process_file() {
  input_file=$1
  mkdir -p $output_dir
  cp $input_file $output_dir/
}
```

## Error Handling

- Use `trap cleanup EXIT` for resource cleanup (temp files, background processes).
- Check command existence with `command -v` before calling optional tools.
- Use `|| true` only for genuinely optional commands. DO NOT suppress errors blindly.

```bash
# DO — trap for cleanup, command check
cleanup() { [[ -n "${tmpdir:-}" ]] && rm -rf "$tmpdir"; }
trap cleanup EXIT

tmpdir="$(mktemp -d)"
command -v jq >/dev/null 2>&1 || { printf "jq is required\n" >&2; exit 1; }

# DON'T — no cleanup, silent failure
tmpdir=/tmp/myscript$$
mkdir $tmpdir
jq '.key' data.json || true  # silently swallows real errors
```

## Portability

- Use `[[ ]]` for conditionals in bash-only scripts (supports regex, pattern matching, no word splitting).
- Use `[ ]` if the script must run under `/bin/sh` or dash.
- Use `printf` over `echo` — `echo` behavior varies across shells (`-n`, `-e` flags, backslash handling).

```bash
# DO — printf for portable output, [[ ]] for bash
printf "Processing %d files\n" "$count"
if [[ "$filename" =~ \.tar\.gz$ ]]; then
  extract "$filename"
fi

# DON'T — echo with flags, [ ] with unquoted variables
echo -e "Processing $count files\n"
if [ $filename = *.tar.gz ]; then
  extract $filename
fi
```

## Tools and Linting

- Run `shellcheck` on all `.sh` files. DO NOT disable warnings (`# shellcheck disable=SCxxxx`) without a comment explaining why.
- Use `mktemp` for temp files and directories. Never hardcode `/tmp/myscript`.
- Use `readonly` for constants. Use `declare -a` for arrays.

```bash
# DO — shellcheck clean, mktemp, readonly
readonly VERSION="1.2.0"
readonly CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/myapp"
tmpfile="$(mktemp)"

# DON'T — hardcoded temp path, mutable constant
VERSION=1.2.0
tmpfile=/tmp/myapp_tmp
```

## IO and Text Processing

- Use heredocs for multi-line output. Use process substitution (`<(...)`) to avoid subshell variable scoping issues.
- Prefer `while IFS= read -r line` for reading files line-by-line. DO NOT use `for line in $(cat file)`.

```bash
# DO — read file line-by-line safely
while IFS= read -r line; do
  printf "Line: %s\n" "$line"
done < "$input_file"

# DON'T — word splitting and glob expansion on every line
for line in $(cat $input_file); do
  echo $line
done
```

## Testing

- Add a `--self-test` flag for scripts that warrant it. Run basic assertions inline.
- Use assertion helper functions for readable test output.

```bash
# DO — self-test pattern
assert_eq() {
  local label="$1" expected="$2" actual="$3"
  if [[ "$expected" != "$actual" ]]; then
    printf "FAIL: %s — expected '%s', got '%s'\n" "$label" "$expected" "$actual" >&2
    return 1
  fi
  printf "PASS: %s\n" "$label"
}

if [[ "${1:-}" == "--self-test" ]]; then
  assert_eq "parse_port valid" "8080" "$(parse_port '8080')"
  assert_eq "parse_port default" "3000" "$(parse_port '')"
  exit 0
fi
```

## Common Footguns

- **Unquoted variables**: `rm -rf $dir/` with an empty `$dir` becomes `rm -rf /`. Always quote.
- **Word splitting**: `for f in $(ls *.txt)` breaks on filenames with spaces. Use `for f in *.txt` or `find` with `-print0`.
- **cd without error handling**: Running destructive commands on a separate line after `cd` — if `cd` fails, the next command runs in the wrong (current) directory. The safe forms are `cd /some/dir && rm -rf .` (stops if `cd` fails) or `cd /some/dir || exit 1` followed by the destructive command on the next line.
- **Pipes hide exit codes**: In `cmd1 | cmd2`, only `cmd2`'s exit code is checked by default. Use `set -o pipefail` (included in `set -euo pipefail`).
- **Subshell variable scope**: Variables set inside `while read ... done < <(cmd)` using process substitution persist. Variables set inside `cmd | while read ...` do not — the pipe creates a subshell.

## Primary Sources

- Bash Reference Manual (gnu.org/software/bash/manual/)
- POSIX Shell Command Language (pubs.opengroup.org/onlinepubs/9699919799/utilities/V3_chap02.html)
- ShellCheck Wiki (shellcheck.net/wiki/)
- Google Shell Style Guide (google.github.io/styleguide/shellguide.html)

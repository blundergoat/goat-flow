#!/usr/bin/env bash
# =============================================================================
# Browser Tools Installer
# =============================================================================
# Creates a user-local Python venv, installs browser-use, installs Python
# Playwright, and installs Playwright's Chromium browser for local browser
# automation checks.
#
# Usage:
#   scripts/install-browser-tools.sh
#   scripts/install-browser-tools.sh --with-system-deps
#   scripts/install-browser-tools.sh --no-system-deps
#   scripts/install-browser-tools.sh --force
#
# Notes:
#   - Default install path: ~/.local/share/goatflow-browser-tools/venv
#   - CLI wrapper path:    ~/.local/bin/browser-use when ~/.local/bin is on
#     PATH; otherwise the first conservative writable PATH directory
#     (for example /usr/local/bin). Override with BROWSER_TOOLS_BIN_DIR.
#   - Python wrapper path: same directory as the CLI wrapper.
#   - On WSL, --with-system-deps is auto-enabled because Chromium needs OS
#     libraries (libnss3, libgbm1, libgtk-3-0, libasound2, ...) that stock
#     WSL2 images don't ship. Pass --no-system-deps to skip.
#   - Refuses to overwrite an existing browser-use wrapper that wasn't written
#     by this script (e.g. from `uv tool install browser-use` or `pipx install
#     browser-use`) unless --force is passed.
#   - The script does not write to repo .env files or install Python packages
#     into the project's app environment.
# =============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
NC='\033[0m'

INSTALL_ROOT="${BROWSER_TOOLS_HOME:-$HOME/.local/share/goatflow-browser-tools}"
VENV_DIR="${BROWSER_TOOLS_VENV:-$INSTALL_ROOT/venv}"
DEFAULT_BIN_DIR="$HOME/.local/bin"
BIN_DIR="${BROWSER_TOOLS_BIN_DIR:-}"
WRAPPER_PY=""
WRAPPER_BU=""
WRAPPER_MARKER="goatflow-browser-tools-wrapper"
ORIGINAL_PATH="$PATH"
WITH_SYSTEM_DEPS=false
NO_SYSTEM_DEPS=false
FORCE=false

usage() {
    cat <<'EOF'
Usage: scripts/install-browser-tools.sh [OPTIONS]

Options:
  --with-system-deps  Also install Playwright OS dependencies.
                      May invoke sudo through Playwright on Linux.
                      Auto-enabled on WSL unless --no-system-deps is set.
  --no-system-deps    Skip system dependency install even on WSL.
  --force             Recreate the venv and overwrite existing wrappers in
                      ~/.local/bin (including foreign wrappers from uv/pipx).
  --help, -h          Show this help.

Environment overrides:
  BROWSER_TOOLS_HOME     Install root. Default: ~/.local/share/goatflow-browser-tools
  BROWSER_TOOLS_VENV     Virtualenv path. Default: $BROWSER_TOOLS_HOME/venv
  BROWSER_TOOLS_BIN_DIR  Wrapper dir. Default: ~/.local/bin when visible on PATH,
                         otherwise a conservative writable PATH directory.
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --with-system-deps)
            WITH_SYSTEM_DEPS=true
            shift
            ;;
        --no-system-deps)
            NO_SYSTEM_DEPS=true
            shift
            ;;
        --force)
            FORCE=true
            shift
            ;;
        --help|-h)
            usage
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}" >&2
            usage >&2
            exit 2
            ;;
    esac
done

if [[ "$WITH_SYSTEM_DEPS" == true && "$NO_SYSTEM_DEPS" == true ]]; then
    echo -e "${RED}Cannot pass both --with-system-deps and --no-system-deps.${NC}" >&2
    usage >&2
    exit 2
fi

is_wsl() {
    [[ -f /proc/version ]] && grep -qi "microsoft\|wsl" /proc/version 2>/dev/null
}

if is_wsl && [[ "$WITH_SYSTEM_DEPS" == false && "$NO_SYSTEM_DEPS" == false ]]; then
    echo -e "${YELLOW}WSL detected - enabling --with-system-deps automatically.${NC}"
    echo -e "${WHITE}Chromium needs OS libraries (libnss3, libatk, etc.) that WSL does not ship.${NC}"
    echo -e "${WHITE}Pass --no-system-deps to skip this (browser will likely fail to launch).${NC}"
    WITH_SYSTEM_DEPS=true
fi

command_exists() {
    command -v "$1" >/dev/null 2>&1
}

path_contains_dir_in() {
    local path_value="$1"
    local dir="$2"

    [[ ":$path_value:" == *":$dir:"* ]]
}

path_contains_dir() {
    path_contains_dir_in "$PATH" "$1"
}

find_path_visible_bin_dir() {
    local dir
    local path_entries

    IFS=':' read -r -a path_entries <<< "$PATH"
    for dir in "${path_entries[@]}"; do
        if [[ -z "$dir" || ! -d "$dir" || ! -w "$dir" ]]; then
            continue
        fi
        # Keep auto-placement predictable. Avoid repo-local, toolchain, Windows,
        # and temporary PATH entries even if they are writable.
        case "$dir" in
            "$DEFAULT_BIN_DIR"|"$HOME/bin"|/usr/local/bin)
                printf '%s\n' "$dir"
                return 0
                ;;
        esac
    done

    return 1
}

select_bin_dir() {
    local visible_dir

    if [[ -n "${BROWSER_TOOLS_BIN_DIR:-}" ]]; then
        BIN_DIR="$BROWSER_TOOLS_BIN_DIR"
        BIN_DIR_REASON="BROWSER_TOOLS_BIN_DIR override"
        return 0
    fi

    if path_contains_dir "$DEFAULT_BIN_DIR"; then
        BIN_DIR="$DEFAULT_BIN_DIR"
        BIN_DIR_REASON="default user bin is already on PATH"
        return 0
    fi

    visible_dir="$(find_path_visible_bin_dir || true)"
    if [[ -n "$visible_dir" ]]; then
        BIN_DIR="$visible_dir"
        BIN_DIR_REASON="selected writable PATH directory so command -v can see browser-use"
        return 0
    fi

    BIN_DIR="$DEFAULT_BIN_DIR"
    BIN_DIR_REASON="fallback user bin; add it to PATH after install"
}

resolve_file_path() {
    readlink -f "$1" 2>/dev/null || printf '%s\n' "$1"
}

find_python() {
    local candidate
    for candidate in python3.13 python3.12 python3.11 python3; do
        if ! command_exists "$candidate"; then
            continue
        fi
        if "$candidate" -c "import sys; exit(0 if sys.version_info >= (3, 11) else 1)" 2>/dev/null; then
            PYTHON_CMD="$candidate"
            PYTHON_VERSION="$("$candidate" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>/dev/null)"
            return 0
        fi
    done
    return 1
}

# Refuse to overwrite a wrapper that wasn't written by this script unless
# --force is explicit. Existing wrappers from this script are detected by the
# marker or the current install root.
guard_existing_wrapper() {
    local path="$1"
    local content
    local target

    if [[ ! -e "$path" && ! -L "$path" ]]; then
        return 0
    fi
    if [[ -d "$path" && ! -L "$path" ]]; then
        echo -e "${RED}Refusing to overwrite directory: $path${NC}" >&2
        exit 3
    fi
    if grep -q "$WRAPPER_MARKER" "$path" 2>/dev/null; then
        return 0
    fi

    content="$(cat "$path" 2>/dev/null || true)"
    if [[ "$content" == *"$INSTALL_ROOT/"* ]]; then
        echo -e "${YELLOW}Upgrading wrapper from previous install: $path${NC}"
        return 0
    fi
    if [[ "$FORCE" == true ]]; then
        echo -e "${YELLOW}Overwriting foreign wrapper $path (--force)${NC}"
        return 0
    fi

    target="$(readlink -f "$path" 2>/dev/null || echo "$path")"
    echo -e "${RED}Refusing to overwrite existing wrapper: $path${NC}" >&2
    echo -e "${WHITE}It points to: ${target}${NC}" >&2
    echo -e "${WHITE}Looks like another installer (e.g. ${GREEN}uv tool install browser-use${WHITE}) created it.${NC}" >&2
    echo -e "${WHITE}If you want this script to manage it instead, rerun with ${GREEN}--force${WHITE}.${NC}" >&2
    exit 3
}

echo -e "${CYAN}Installing browser tools for local browser automation${NC}"

PYTHON_CMD=""
PYTHON_VERSION=""
if ! find_python; then
    echo -e "${RED}Python 3.11+ is required for browser-use.${NC}" >&2
    echo -e "${WHITE}Install Python 3.11+ first, then rerun this script.${NC}" >&2
    exit 1
fi

echo -e "${GREEN}Python ${PYTHON_VERSION} found (${PYTHON_CMD})${NC}"

select_bin_dir
WRAPPER_PY="$BIN_DIR/browser-use-python"
WRAPPER_BU="$BIN_DIR/browser-use"
echo -e "${GREEN}Wrapper dir: ${BIN_DIR} (${BIN_DIR_REASON})${NC}"

# Fail fast if a foreign wrapper is in the way, before doing the expensive install.
guard_existing_wrapper "$WRAPPER_PY"
guard_existing_wrapper "$WRAPPER_BU"

if [[ "$FORCE" == true && -d "$VENV_DIR" ]]; then
    echo -e "${YELLOW}Removing existing venv: ${VENV_DIR}${NC}"
    rm -rf "$VENV_DIR"
fi

mkdir -p "$INSTALL_ROOT" "$BIN_DIR"

if [[ ! -x "$VENV_DIR/bin/python" ]]; then
    echo -e "${CYAN}Creating venv: ${WHITE}${VENV_DIR}${NC}"
    "$PYTHON_CMD" -m venv "$VENV_DIR"
fi

VENV_PYTHON="$VENV_DIR/bin/python"

echo -e "${CYAN}Upgrading packaging tools${NC}"
"$VENV_PYTHON" -m pip install --upgrade --quiet pip setuptools wheel

echo -e "${CYAN}Installing browser-use and Python Playwright${NC}"
"$VENV_PYTHON" -m pip install --upgrade --quiet browser-use playwright

echo -e "${CYAN}Installing Playwright Chromium browser${NC}"
if [[ "$WITH_SYSTEM_DEPS" == true ]]; then
    "$VENV_PYTHON" -m playwright install --with-deps chromium
else
    "$VENV_PYTHON" -m playwright install chromium
fi

# Prefer the published entry point. The browser_use package is not executable
# with `python -m browser_use` in current releases.
if [[ ! -x "$VENV_DIR/bin/browser-use" ]]; then
    echo -e "${RED}Expected browser-use entry point was not installed: $VENV_DIR/bin/browser-use${NC}" >&2
    exit 1
fi

rm -f "$WRAPPER_PY"
cat > "$WRAPPER_PY" <<EOF
#!/usr/bin/env bash
# $WRAPPER_MARKER
# browser-use uses IN_DOCKER to decide whether Chrome needs --no-sandbox.
# Root shells in some containers do not expose /.dockerenv or cgroup hints, so
# set the hint at wrapper time before browser_use.config is imported.
if [[ -z "\${IN_DOCKER:-}" ]] && [[ "\$(id -u)" -eq 0 ]]; then
    export IN_DOCKER=true
fi
exec "$VENV_PYTHON" "\$@"
EOF
chmod +x "$WRAPPER_PY"

rm -f "$WRAPPER_BU"
cat > "$WRAPPER_BU" <<EOF
#!/usr/bin/env bash
# $WRAPPER_MARKER
# browser-use uses IN_DOCKER to decide whether Chrome needs --no-sandbox.
# Root shells in some containers do not expose /.dockerenv or cgroup hints, so
# set the hint at wrapper time before browser_use.config is imported.
if [[ -z "\${IN_DOCKER:-}" ]] && [[ "\$(id -u)" -eq 0 ]]; then
    export IN_DOCKER=true
fi

browser_use_target=("$VENV_DIR/bin/browser-use")
browser_use_home="\${BROWSER_USE_HOME:-\$HOME/.browser-use}"
browser_use_session="default"
browser_use_close=false
browser_use_close_all=false
browser_use_expect_session=false

for browser_use_arg in "\$@"; do
    if [[ "\$browser_use_expect_session" == true ]]; then
        browser_use_session="\$browser_use_arg"
        browser_use_expect_session=false
        continue
    fi
    case "\$browser_use_arg" in
        --session)
            browser_use_expect_session=true
            ;;
        --session=*)
            browser_use_session="\${browser_use_arg#--session=}"
            ;;
        close)
            browser_use_close=true
            ;;
        --all)
            if [[ "\$browser_use_close" == true ]]; then
                browser_use_close_all=true
            fi
            ;;
    esac
done

browser_use_kill_pid() {
    local pid="\$1"
    local child_pid

    if [[ ! "\$pid" =~ ^[0-9]+$ ]] || ! kill -0 "\$pid" 2>/dev/null; then
        return 0
    fi
    if ! browser_use_pid_is_owned "\$pid"; then
        return 0
    fi
    if command -v pgrep >/dev/null 2>&1; then
        while IFS= read -r child_pid; do
            if browser_use_pid_is_owned "\$child_pid"; then
                kill "\$child_pid" 2>/dev/null || true
            fi
        done < <(pgrep -P "\$pid" || true)
    fi
    kill "\$pid" 2>/dev/null || true
    sleep 0.2
    if command -v pgrep >/dev/null 2>&1; then
        while IFS= read -r child_pid; do
            if browser_use_pid_is_owned "\$child_pid"; then
                kill -9 "\$child_pid" 2>/dev/null || true
            fi
        done < <(pgrep -P "\$pid" || true)
    fi
    kill -9 "\$pid" 2>/dev/null || true
}

browser_use_pid_args() {
    ps -o args= -p "\$1" 2>/dev/null || true
}

browser_use_pid_is_owned() {
    local pid="\$1"
    local args

    if [[ ! "\$pid" =~ ^[0-9]+$ ]]; then
        return 1
    fi
    args="\$(browser_use_pid_args "\$pid")"
    if [[ -z "\$args" ]]; then
        return 1
    fi
    case "\$args" in
        *"browser_use.skill_cli.daemon --session"*|*"$VENV_DIR/bin/browser-use"*|*"$VENV_PYTHON"*browser_use*|*chrome*--remote-debugging-port*|*chromium*--remote-debugging-port*|*Chrome*--remote-debugging-port*)
            return 0
            ;;
    esac
    return 1
}

if [[ "\$browser_use_close" == true ]]; then
    browser_use_pids=()
    if [[ "\$browser_use_close_all" == true ]]; then
        for browser_use_pid_file in "\$browser_use_home"/*.pid; do
            [[ -f "\$browser_use_pid_file" ]] || continue
            browser_use_pids+=("\$(cat "\$browser_use_pid_file" 2>/dev/null || true)")
        done
    elif [[ -f "\$browser_use_home/\$browser_use_session.pid" ]]; then
        browser_use_pids+=("\$(cat "\$browser_use_home/\$browser_use_session.pid" 2>/dev/null || true)")
    fi
    if command -v pgrep >/dev/null 2>&1; then
        if [[ "\$browser_use_close_all" == true ]]; then
            while IFS= read -r browser_use_pid; do
                browser_use_pids+=("\$browser_use_pid")
            done < <(pgrep -f "browser_use.skill_cli.daemon --session" || true)
        else
            while IFS= read -r browser_use_pid; do
                browser_use_pids+=("\$browser_use_pid")
            done < <(pgrep -f "browser_use.skill_cli.daemon --session \$browser_use_session" || true)
        fi
    fi

    "\${browser_use_target[@]}" "\$@"
    browser_use_status="\$?"

    for browser_use_pid in "\${browser_use_pids[@]}"; do
        browser_use_kill_pid "\$browser_use_pid"
    done
    exit "\$browser_use_status"
fi

exec "\${browser_use_target[@]}" "\$@"
EOF
chmod +x "$WRAPPER_BU"

echo -e "${CYAN}Verifying CLI wrappers are visible${NC}"
if ! path_contains_dir "$BIN_DIR"; then
    export PATH="$BIN_DIR:$PATH"
fi
hash -r 2>/dev/null || true

RESOLVED_BU="$(command -v browser-use || true)"
RESOLVED_PY="$(command -v browser-use-python || true)"
if [[ -z "$RESOLVED_BU" || -z "$RESOLVED_PY" ]]; then
    echo -e "${RED}browser-use wrappers were installed but command -v cannot find them.${NC}" >&2
    echo -e "${WHITE}Expected CLI wrapper:${NC} ${WRAPPER_BU}" >&2
    echo -e "${WHITE}Expected Python wrapper:${NC} ${WRAPPER_PY}" >&2
    echo -e "${WHITE}PATH used by installer:${NC} ${PATH}" >&2
    exit 1
fi

if [[ "$(resolve_file_path "$RESOLVED_BU")" != "$(resolve_file_path "$WRAPPER_BU")" ]]; then
    echo -e "${YELLOW}browser-use resolves to an existing PATH entry before this wrapper:${NC} ${RESOLVED_BU}" >&2
    echo -e "${WHITE}This install also wrote:${NC} ${WRAPPER_BU}" >&2
fi
if [[ "$(resolve_file_path "$RESOLVED_PY")" != "$(resolve_file_path "$WRAPPER_PY")" ]]; then
    echo -e "${YELLOW}browser-use-python resolves to an existing PATH entry before this wrapper:${NC} ${RESOLVED_PY}" >&2
    echo -e "${WHITE}This install also wrote:${NC} ${WRAPPER_PY}" >&2
fi
echo -e "${GREEN}command -v browser-use -> ${RESOLVED_BU}${NC}"
echo -e "${GREEN}command -v browser-use-python -> ${RESOLVED_PY}${NC}"

echo -e "${CYAN}Verifying Python modules${NC}"
"$VENV_PYTHON" - <<'PY'
import importlib.util
import sys

missing = [name for name in ("browser_use", "playwright") if importlib.util.find_spec(name) is None]
if missing:
    print("Missing modules: " + ", ".join(missing), file=sys.stderr)
    raise SystemExit(1)

print("browser-use and Playwright import ok")
PY

echo -e "${CYAN}Verifying Chromium launches${NC}"
BROWSER_OK=true
LAUNCH_OUTPUT=""
if LAUNCH_OUTPUT=$("$VENV_PYTHON" - 2>&1 <<'PY'
from playwright.sync_api import sync_playwright
import sys

try:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto("data:text/html,<h1>ok</h1>")
        title = page.content()
        browser.close()
        if "ok" in title:
            print("Chromium launched and rendered a page successfully")
        else:
            print("Chromium launched but page content was unexpected", file=sys.stderr)
            sys.exit(1)
except Exception as e:
    print(f"Chromium failed to launch: {e}", file=sys.stderr)
    sys.exit(1)
PY
); then
    echo -e "${GREEN}${LAUNCH_OUTPUT}${NC}"
else
    BROWSER_OK=false
    echo -e "${RED}Chromium failed to launch.${NC}" >&2
    echo "$LAUNCH_OUTPUT" >&2
    echo "" >&2
    if is_wsl; then
        echo -e "${YELLOW}On WSL, Chromium needs system libraries that are not installed by default.${NC}" >&2
        echo -e "${WHITE}Try reinstalling with system dependencies:${NC}" >&2
        echo -e "  ${GREEN}$0 --force --with-system-deps${NC}" >&2
    else
        echo -e "${YELLOW}Chromium may be missing OS-level dependencies.${NC}" >&2
        echo -e "${WHITE}Try reinstalling with system dependencies:${NC}" >&2
        echo -e "  ${GREEN}$0 --force --with-system-deps${NC}" >&2
        echo -e "${WHITE}Or install them manually:${NC}" >&2
        echo -e "  ${GREEN}${VENV_PYTHON} -m playwright install-deps chromium${NC}" >&2
    fi
fi

verify_browser_use_cli() {
    local smoke_dir
    local smoke_home
    local smoke_file
    local smoke_http_pid
    local smoke_port
    local smoke_session
    local smoke_pid_file
    local smoke_pid
    local smoke_url
    local open_output
    local title_output

    smoke_dir="$(mktemp -d)"
    smoke_home="$smoke_dir/browser-use-home"
    smoke_file="$smoke_dir/browser-use-smoke.html"
    smoke_http_pid=""
    smoke_port="$("$VENV_PYTHON" - <<'PY'
import socket

with socket.socket() as s:
    s.bind(("127.0.0.1", 0))
    print(s.getsockname()[1])
PY
)"
    smoke_session="goatflow-install-smoke"
    smoke_pid_file="$smoke_home/$smoke_session.pid"
    smoke_pid=""
    smoke_url="http://127.0.0.1:$smoke_port/$(basename "$smoke_file")"

    cleanup_browser_use_cli_smoke() {
        if [[ -f "$smoke_pid_file" ]]; then
            smoke_pid="$(cat "$smoke_pid_file" 2>/dev/null || true)"
        fi
        BROWSER_USE_HOME="$smoke_home" browser-use --session "$smoke_session" close >/dev/null 2>&1 || true
        if [[ -n "$smoke_pid" ]] && kill -0 "$smoke_pid" 2>/dev/null; then
            if command_exists pgrep; then
                while IFS= read -r child_pid; do
                    kill "$child_pid" 2>/dev/null || true
                done < <(pgrep -P "$smoke_pid" || true)
            fi
            kill "$smoke_pid" 2>/dev/null || true
            sleep 0.2
            if command_exists pgrep; then
                while IFS= read -r child_pid; do
                    kill -9 "$child_pid" 2>/dev/null || true
                done < <(pgrep -P "$smoke_pid" || true)
            fi
            kill -9 "$smoke_pid" 2>/dev/null || true
        fi
        if [[ -n "$smoke_http_pid" ]] && kill -0 "$smoke_http_pid" 2>/dev/null; then
            kill "$smoke_http_pid" 2>/dev/null || true
        fi
        rm -rf "$smoke_dir"
    }

    printf '%s\n' '<!doctype html><title>goat-flow browser-use smoke</title><h1>ok</h1>' > "$smoke_file"
    "$VENV_PYTHON" -m http.server "$smoke_port" --bind 127.0.0.1 --directory "$smoke_dir" > "$smoke_dir/http.log" 2>&1 &
    smoke_http_pid="$!"

    for _ in {1..50}; do
        if "$VENV_PYTHON" -c "import urllib.request; urllib.request.urlopen('$smoke_url', timeout=0.2).read()" >/dev/null 2>&1; then
            break
        fi
        sleep 0.1
    done

    if ! open_output="$(BROWSER_USE_HOME="$smoke_home" browser-use --session "$smoke_session" open "$smoke_url" 2>&1)"; then
        echo "$open_output" >&2
        cleanup_browser_use_cli_smoke
        return 1
    fi

    if ! title_output="$(BROWSER_USE_HOME="$smoke_home" browser-use --session "$smoke_session" get title 2>&1)"; then
        echo "$title_output" >&2
        cleanup_browser_use_cli_smoke
        return 1
    fi

    if [[ "$title_output" != *"goat-flow browser-use smoke"* ]]; then
        echo "browser-use CLI title check returned unexpected output: $title_output" >&2
        cleanup_browser_use_cli_smoke
        return 1
    fi

    cleanup_browser_use_cli_smoke
    echo "browser-use CLI opened and read a local page successfully"
}

if [[ "$BROWSER_OK" == true ]]; then
    echo -e "${CYAN}Verifying browser-use CLI launches${NC}"
    CLI_OUTPUT=""
    if CLI_OUTPUT="$(verify_browser_use_cli 2>&1)"; then
        echo -e "${GREEN}${CLI_OUTPUT}${NC}"
    else
        BROWSER_OK=false
        echo -e "${RED}browser-use CLI failed to launch a browser.${NC}" >&2
        echo "$CLI_OUTPUT" >&2
    fi
fi

echo ""
if [[ "$BROWSER_OK" == true ]]; then
    echo -e "${GREEN}Browser tools installed and verified successfully.${NC}"
else
    echo -e "${YELLOW}Browser tools installed but Chromium cannot launch yet (see above).${NC}"
fi
echo -e "${WHITE}CLI wrapper:${NC}    ${GREEN}${WRAPPER_BU}${NC}"
echo -e "${WHITE}Python wrapper:${NC} ${GREEN}${WRAPPER_PY}${NC}"
echo -e "${WHITE}Run diagnostics:${NC}"
echo -e "  ${GREEN}command -v browser-use${NC}"
echo -e "  ${GREEN}browser-use doctor${NC}"

if ! path_contains_dir_in "$ORIGINAL_PATH" "$BIN_DIR"; then
    echo ""
    echo -e "${YELLOW}${BIN_DIR} is not currently in PATH.${NC}"
    echo -e "${WHITE}Add this to your shell profile if you want the wrapper available everywhere:${NC}"
    echo -e "  ${GREEN}export PATH=\"${BIN_DIR}:\$PATH\"${NC}"
fi

if [[ "$BROWSER_OK" != true ]]; then
    exit 1
fi

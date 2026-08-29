#!/usr/bin/env bash
# =============================================================================
# Browser Tools Installer
# =============================================================================
# Creates a user-local Python venv with two deliberately separate paths:
# browser-use controls an approved user/system Chrome or explicit CDP endpoint;
# browser-use-python exposes Python Playwright and its managed Chromium.
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
  --force             Recreate the venv and overwrite existing wrappers in the
                      selected wrapper directory, including uv/pipx wrappers.
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

validate_force_venv_target() {
    local forbidden
    local resolved_install_root
    local resolved_project_root
    local resolved_target
    local resolved_user_home

    resolved_target="$(resolve_file_path "$VENV_DIR")"
    resolved_install_root="$(resolve_file_path "$INSTALL_ROOT")"
    resolved_project_root="$(resolve_file_path "$PWD")"
    resolved_user_home="$(resolve_file_path "$HOME")"

    for forbidden in / "$resolved_user_home" "$resolved_install_root" "$resolved_project_root"; do
        if [[ "$resolved_target" == "$forbidden" ]]; then
            echo -e "${RED}Refusing --force removal of broad path: ${resolved_target}${NC}" >&2
            exit 4
        fi
    done
    if [[ ! -f "$VENV_DIR/pyvenv.cfg" ]]; then
        echo -e "${RED}Refusing --force removal because this is not a recognizable Python venv: ${VENV_DIR}${NC}" >&2
        echo -e "${WHITE}Expected marker: ${VENV_DIR}/pyvenv.cfg${NC}" >&2
        exit 4
    fi
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
    validate_force_venv_target
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

echo -e "${CYAN}Installing browser-use CLI 3.0 and Python Playwright${NC}"
# The wrapper and smoke below use browser-use's 0.13 CLI 3.0 stdin-Python
# contract. Bound the compatible line so a future CLI migration fails here
# instead of silently invalidating the installed instructions.
"$VENV_PYTHON" -m pip install --upgrade --quiet "browser-use~=0.13.8" playwright

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
exec "$VENV_DIR/bin/browser-use" "\$@"
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
    local cli_help
    local cli_output
    local smoke_cdp_port
    local smoke_cdp_url
    local smoke_chrome_pid
    local smoke_dir
    local smoke_home
    local smoke_file
    local smoke_http_pid
    local smoke_http_port
    local smoke_ports
    local smoke_runtime
    local smoke_tmp
    local smoke_url

    smoke_dir="$(mktemp -d)"
    smoke_home="$smoke_dir/home"
    smoke_runtime="$smoke_dir/runtime"
    smoke_tmp="$smoke_dir/tmp"
    smoke_file="$smoke_dir/browser-use-smoke.html"
    smoke_http_pid=""
    smoke_chrome_pid=""
    smoke_ports="$("$VENV_PYTHON" - <<'PY'
import socket

with socket.socket() as http_socket, socket.socket() as cdp_socket:
    http_socket.bind(("127.0.0.1", 0))
    cdp_socket.bind(("127.0.0.1", 0))
    print(http_socket.getsockname()[1], cdp_socket.getsockname()[1])
PY
)"
    read -r smoke_http_port smoke_cdp_port <<< "$smoke_ports"
    smoke_cdp_url="http://127.0.0.1:$smoke_cdp_port"
    smoke_url="http://127.0.0.1:$smoke_http_port/$(basename "$smoke_file")"
    mkdir -p "$smoke_home" "$smoke_runtime" "$smoke_tmp"

    stop_browser_smoke_process() {
        local pid="$1"

        if [[ ! "$pid" =~ ^[0-9]+$ ]] || ! kill -0 "$pid" 2>/dev/null; then
            return 0
        fi
        kill "$pid" 2>/dev/null || true
        for _ in {1..20}; do
            if ! kill -0 "$pid" 2>/dev/null; then
                wait "$pid" 2>/dev/null || true
                return 0
            fi
            sleep 0.1
        done
        kill -9 "$pid" 2>/dev/null || true
        wait "$pid" 2>/dev/null || true
    }

    cleanup_browser_use_cli_smoke() {
        BH_HOME="$smoke_home" \
            BH_RUNTIME_DIR="$smoke_runtime" \
            BH_TMP_DIR="$smoke_tmp" \
            BU_CDP_URL="$smoke_cdp_url" \
            "$WRAPPER_BU" --reload >/dev/null 2>&1 || true
        stop_browser_smoke_process "$smoke_chrome_pid"
        stop_browser_smoke_process "$smoke_http_pid"
        rm -rf "$smoke_dir"
    }

    if ! cli_help="$("$WRAPPER_BU" --help 2>&1)"; then
        echo "$cli_help" >&2
        cleanup_browser_use_cli_smoke
        return 1
    fi
    if [[ "$cli_help" != *"browser-use <<'PY'"* || "$cli_help" != *"page_info()"* ]]; then
        echo "Installed browser-use does not expose the required CLI 3.0 stdin-Python interface." >&2
        echo "$cli_help" >&2
        cleanup_browser_use_cli_smoke
        return 1
    fi

    printf '%s\n' '<!doctype html><title>goat-flow browser-use smoke</title><h1>ok</h1><script>console.error("goat-flow smoke error")</script>' > "$smoke_file"
    "$VENV_PYTHON" -m http.server "$smoke_http_port" --bind 127.0.0.1 --directory "$smoke_dir" > "$smoke_dir/http.log" 2>&1 &
    smoke_http_pid="$!"

    "$VENV_PYTHON" - "$smoke_cdp_port" > "$smoke_dir/chromium.log" 2>&1 <<'PY' &
import signal
import sys
import time

from playwright.sync_api import sync_playwright

stopping = False


def request_stop(_signum, _frame):
    global stopping
    stopping = True


signal.signal(signal.SIGINT, request_stop)
signal.signal(signal.SIGTERM, request_stop)

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(
        headless=True,
        args=[
            "--remote-debugging-address=127.0.0.1",
            f"--remote-debugging-port={sys.argv[1]}",
        ],
    )
    while not stopping:
        time.sleep(0.1)
    browser.close()
PY
    smoke_chrome_pid="$!"

    for _ in {1..50}; do
        if "$VENV_PYTHON" -c "import urllib.request; urllib.request.urlopen('$smoke_url', timeout=0.2).read()" >/dev/null 2>&1; then
            break
        fi
        sleep 0.1
    done
    if ! "$VENV_PYTHON" -c "import urllib.request; urllib.request.urlopen('$smoke_url', timeout=0.2).read()" >/dev/null 2>&1; then
        echo "Local browser-use smoke page did not become ready." >&2
        cleanup_browser_use_cli_smoke
        return 1
    fi

    for _ in {1..100}; do
        if "$VENV_PYTHON" -c "import urllib.request; urllib.request.urlopen('$smoke_cdp_url/json/version', timeout=0.2).read()" >/dev/null 2>&1; then
            break
        fi
        sleep 0.1
    done
    if ! "$VENV_PYTHON" -c "import urllib.request; urllib.request.urlopen('$smoke_cdp_url/json/version', timeout=0.2).read()" >/dev/null 2>&1; then
        echo "Isolated Playwright Chromium did not expose its loopback CDP endpoint." >&2
        cleanup_browser_use_cli_smoke
        return 1
    fi

    if ! cli_output="$(
        BROWSER_USE_SMOKE_URL="$smoke_url" \
            BH_HOME="$smoke_home" \
            BH_RUNTIME_DIR="$smoke_runtime" \
            BH_TMP_DIR="$smoke_tmp" \
            BU_CDP_URL="$smoke_cdp_url" \
            "$WRAPPER_BU" 2>&1 <<'PY'
import os

drain_events()
new_tab(os.environ["BROWSER_USE_SMOKE_URL"])
wait_for_load()
events = drain_events()
console_error_count = sum(
    event.get("method") == "Runtime.exceptionThrown"
    or (
        event.get("method") == "Runtime.consoleAPICalled"
        and (event.get("params") or {}).get("type") == "error"
    )
    for event in events
)
print(page_info())
print(js("document.title"))
print(capture_screenshot())
print(f"console_errors={console_error_count}")
PY
    )"; then
        echo "$cli_output" >&2
        cleanup_browser_use_cli_smoke
        return 1
    fi

    if [[ "$cli_output" != *"goat-flow browser-use smoke"* ]]; then
        echo "browser-use CLI title check returned unexpected output: $cli_output" >&2
        cleanup_browser_use_cli_smoke
        return 1
    fi
    if [[ "$cli_output" != *"console_errors=1"* ]]; then
        echo "browser-use CLI console-event check returned unexpected output: $cli_output" >&2
        cleanup_browser_use_cli_smoke
        return 1
    fi

    cleanup_browser_use_cli_smoke
    echo "browser-use CLI 3.0 opened, read, and captured an isolated local page successfully"
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
echo -e "${WHITE}browser-use controls an approved user/system Chrome or explicit CDP endpoint.${NC}"
echo -e "${WHITE}browser-use-python exposes Python Playwright and its managed Chromium.${NC}"
echo -e "${WHITE}CLI wrapper:${NC}    ${GREEN}${WRAPPER_BU}${NC}"
echo -e "${WHITE}Python wrapper:${NC} ${GREEN}${WRAPPER_PY}${NC}"
echo -e "${WHITE}Run diagnostics:${NC}"
echo -e "  ${GREEN}command -v browser-use${NC}"
echo -e "  ${GREEN}browser-use --doctor${NC}"

if ! path_contains_dir_in "$ORIGINAL_PATH" "$BIN_DIR"; then
    echo ""
    echo -e "${YELLOW}${BIN_DIR} is not currently in PATH.${NC}"
    echo -e "${WHITE}Add this to your shell profile if you want the wrapper available everywhere:${NC}"
    echo -e "  ${GREEN}export PATH=\"${BIN_DIR}:\$PATH\"${NC}"
fi

if [[ "$BROWSER_OK" != true ]]; then
    exit 1
fi

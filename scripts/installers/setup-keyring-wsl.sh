#!/usr/bin/env bash
# ==============================================================================
# setup-keyring-wsl.sh
#
# Configures a headless gnome-keyring daemon in WSL2 so that AI CLIs which use
# libsecret (Antigravity CLI / agy, GitHub CLI, etc.) can persist OAuth tokens
# across shell sessions.
#
# Approach: enables systemd-on-WSL, installs gnome-keyring + libsecret, creates
# an unencrypted "login" keyring with an empty password, and injects an
# idempotent bashrc hook that ensures SecretService is registered for every shell.
#
# Verification: writes and reads a test secret via secret-tool before claiming
# success. If the round-trip fails, the script exits non-zero with a distinct
# exit code per failure mode.
#
# Targets: WSL2 with a systemd-capable distro (Ubuntu 22.04+ recommended).
# Idempotent: safe to re-run.
#
# Exit codes:
#   0  success
#   1  not running in WSL
#   2  systemd just enabled in /etc/wsl.conf - wsl --shutdown required
#   3  systemd configured but not PID 1 - restart WSL
#   4  no user dbus session available
#   5  login keyring creation failed
#   6  secret-tool missing after install
#   7  SecretService write failed
#   8  SecretService read-back mismatch
#   9  required apt/sudo tooling missing
# ==============================================================================

set -euo pipefail
IFS=$'\n\t'

# ---- LOGGING ----
RED=$'\033[0;31m'
GREEN=$'\033[0;32m'
YELLOW=$'\033[0;33m'
BLUE=$'\033[0;34m'
BOLD=$'\033[1m'
NC=$'\033[0m'
PROGRESS_TOTAL=10
CURRENT_STEP=0

log()     { printf '%s[%s]%s %s\n'   "$BLUE"   "INFO" "$NC" "$*"; }
success() { printf '%s[%s]%s %s\n'   "$GREEN"  "OK"   "$NC" "$*"; }
warn()    { printf '%s[%s]%s %s\n'   "$YELLOW" "WARN" "$NC" "$*" >&2; }
error()   { printf '%s[%s]%s %s\n'   "$RED"    "FAIL" "$NC" "$*" >&2; }
step() {
    CURRENT_STEP=$((CURRENT_STEP + 1))
    printf '\n%s==> Step %d/%d: %s%s\n' \
        "$BOLD" "$CURRENT_STEP" "$PROGRESS_TOTAL" "$*" "$NC"
}

show_help() {
    cat <<'EOF'
Usage: setup-keyring-wsl.sh [--help]

Configures gnome-keyring in WSL2 for headless OAuth token persistence.

What it does:
  1. Verifies you are in WSL2
  2. Enables systemd in /etc/wsl.conf (requires wsl --shutdown if changed)
  3. Installs gnome-keyring, libsecret, dbus packages if missing
  4. Initialises an unencrypted login keyring with empty password
  5. Adds a bashrc hook that auto-starts SecretService per session
  6. Verifies the SecretService is reachable via secret-tool round-trip

Progress output prints numbered phases so you can see whether the run stopped
before or after the WSL restart boundary.

Re-run safely: every step is idempotent.

After success, run agy (or any libsecret-using CLI) and the auth token
will persist across new shells.

Options:
  --help, -h    Show this help and exit
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    show_help
    exit 0
fi

if [[ $# -gt 0 ]]; then
    error "Unknown option: $1"
    show_help
    exit 1
fi

# ---- 1. Confirm WSL2 ----
step "Verifying environment"
if ! grep -qi microsoft /proc/version /proc/sys/kernel/osrelease 2>/dev/null; then
    error "This script targets WSL2. This kernel does not look like WSL."
    exit 1
fi
if ! grep -qiE 'wsl2|microsoft-standard-wsl2' /proc/version /proc/sys/kernel/osrelease 2>/dev/null; then
    error "This script requires WSL2 with systemd support."
    error "The kernel looks like WSL, but not WSL2."
    exit 1
fi
success "Running in WSL2"

require_command() {
    command -v "$1" >/dev/null 2>&1
}

run_as_root() {
    if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
        "$@"
    else
        sudo "$@"
    fi
}

secret_service_available() {
    gdbus introspect --session \
        --dest org.freedesktop.secrets \
        --object-path /org/freedesktop/secrets \
        >/dev/null 2>&1
}

# ---- 2. Host tooling ----
step "Checking host tooling"
MISSING_TOOLS=()
for tool in apt-get dpkg-query; do
    if ! require_command "$tool"; then
        MISSING_TOOLS+=("$tool")
    fi
done
if [[ "${EUID:-$(id -u)}" -ne 0 ]] && ! require_command sudo; then
    MISSING_TOOLS+=("sudo")
fi

if (( ${#MISSING_TOOLS[@]} > 0 )); then
    error "Required tooling missing: ${MISSING_TOOLS[*]}"
    error "This helper currently supports apt-based WSL2 distros such as Ubuntu."
    exit 9
fi
success "Required apt/sudo tooling present"

# ---- 3. Systemd in /etc/wsl.conf ----
step "Checking systemd configuration"
WSL_CONF="/etc/wsl.conf"

systemd_enabled_in_conf() {
    # Section-aware check: [boot] section must contain systemd=true
    # (tolerant of whitespace around the = sign; ignores commented lines)
    [[ -f "$WSL_CONF" ]] || return 1
    awk '
        /^[[:space:]]*#/         { next }
        /^\[.*\]/                { section = $0; next }
        section == "[boot]" &&
        /^[[:space:]]*systemd[[:space:]]*=[[:space:]]*true[[:space:]]*$/ { found = 1 }
        END                      { exit !found }
    ' "$WSL_CONF"
}

if ! systemd_enabled_in_conf; then
    log "systemd not enabled in $WSL_CONF - appending [boot] section"
    run_as_root tee -a "$WSL_CONF" >/dev/null <<'EOF'

[boot]
systemd=true
EOF
    error "systemd has been enabled in $WSL_CONF."
    error "Stopped after Step $CURRENT_STEP/$PROGRESS_TOTAL."
    error "Next run resumes after WSL has restarted and systemd is PID 1."
    error "Run 'wsl --shutdown' from Windows PowerShell, then reopen this terminal."
    error "Re-run this script after WSL has restarted."
    exit 2
fi
success "systemd enabled in $WSL_CONF"

# ---- 4. Verify systemd actually running ----
step "Verifying systemd is active"
if [[ "$(ps -p 1 -o comm= 2>/dev/null)" != "systemd" ]]; then
    error "systemd is enabled in $WSL_CONF but is not PID 1."
    error "Stopped at Step $CURRENT_STEP/$PROGRESS_TOTAL."
    error "Run 'wsl --shutdown' from Windows PowerShell, reopen this terminal, then re-run."
    exit 3
fi
success "systemd is PID 1"

# ---- 5. Dependencies ----
step "Checking dependencies"
REQUIRED_PKGS=(gnome-keyring libsecret-1-0 libsecret-tools dbus-user-session libglib2.0-bin)
MISSING=()
for pkg in "${REQUIRED_PKGS[@]}"; do
    if ! dpkg-query -W -f='${Status}' "$pkg" 2>/dev/null | grep -q "ok installed"; then
        MISSING+=("$pkg")
    fi
done

if (( ${#MISSING[@]} > 0 )); then
    log "Installing: ${MISSING[*]}"
    run_as_root apt-get update -qq
    run_as_root apt-get install -y --no-install-recommends "${MISSING[@]}"
    success "Dependencies installed"
else
    success "All dependencies present"
fi

# ---- 6. Verify user dbus session ----
step "Verifying user dbus session"
USER_BUS="/run/user/$(id -u)/bus"
if [[ -n "${DBUS_SESSION_BUS_ADDRESS:-}" ]] && secret_service_available; then
    success "DBUS_SESSION_BUS_ADDRESS is set and SecretService is reachable"
elif [[ -S "$USER_BUS" ]]; then
    export DBUS_SESSION_BUS_ADDRESS="unix:path=$USER_BUS"
    success "Using user dbus at $USER_BUS"
else
    error "No reachable user dbus session found."
    error "dbus-user-session should provide this via 'systemctl --user'."
    error "Try: wsl --shutdown, reopen, re-run."
    exit 4
fi

# ---- 7. Initialise keyring if missing ----
step "Initialising login keyring"
KEYRING_DIR="$HOME/.local/share/keyrings"
mkdir -p "$KEYRING_DIR"
LOGIN_KEYRING="$KEYRING_DIR/login.keyring"

if [[ ! -f "$LOGIN_KEYRING" ]]; then
    log "No login keyring found - creating with empty password (unencrypted)"
    # --daemonize: fork to background
    # --login: create/unlock login keyring using password from stdin
    # --components: register SecretService only; do not replace the user's SSH agent.
    if ! gnome-keyring-daemon \
        --daemonize \
        --login \
        --components=secrets \
        <<< "" >/dev/null; then
        error "gnome-keyring-daemon failed while creating the login keyring."
        exit 5
    fi
    sleep 1
    if [[ -f "$LOGIN_KEYRING" ]]; then
        success "Created $LOGIN_KEYRING"
    else
        error "Expected $LOGIN_KEYRING after creation - daemon may have failed silently."
        error "Try: pgrep -u \"\$USER\" -a gnome-keyring-daemon"
        exit 5
    fi
else
    success "Login keyring already exists at $LOGIN_KEYRING"
fi

# ---- 8. Inject bashrc hook ----
step "Injecting shell bootstrap"
BASHRC="$HOME/.bashrc"
MARKER_START="# >>> setup-keyring-wsl bootstrap >>>"
MARKER_END="# <<< setup-keyring-wsl bootstrap <<<"

if grep -qF "$MARKER_START" "$BASHRC" 2>/dev/null; then
    success "Bashrc hook already present"
else
    log "Adding bashrc hook to $BASHRC"
    cat >> "$BASHRC" <<EOF

$MARKER_START
# Auto-start gnome-keyring-daemon if it is not already registered with the
# user dbus session. Required for libsecret-based CLIs (agy, gh, etc) to
# persist OAuth tokens across shells. Installed by setup-keyring-wsl.sh.
if command -v gnome-keyring-daemon >/dev/null 2>&1 \\
    && command -v gdbus >/dev/null 2>&1; then
    if ! gdbus introspect --session \\
            --dest org.freedesktop.secrets \\
            --object-path /org/freedesktop/secrets \\
            >/dev/null 2>&1 \\
        && [ -S "/run/user/\$(id -u)/bus" ]; then
        export DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/\$(id -u)/bus"
    fi
    if ! gdbus introspect --session \\
            --dest org.freedesktop.secrets \\
            --object-path /org/freedesktop/secrets \\
            >/dev/null 2>&1; then
        eval "\$(echo -n '' | gnome-keyring-daemon \\
            --replace --unlock --components=secrets 2>/dev/null)" || true
        export GNOME_KEYRING_CONTROL
    fi
fi
$MARKER_END
EOF
    success "Hook added"
fi

# Ensure the daemon is alive for the verification step below
if ! secret_service_available; then
    log "Starting gnome-keyring-daemon for this session"
    # shellcheck disable=SC2046
    eval "$(echo -n '' | gnome-keyring-daemon \
        --replace --unlock --components=secrets 2>/dev/null)" || true
    export GNOME_KEYRING_CONTROL
    sleep 1
fi

# ---- 9. Verification ----
step "Verifying SecretService round-trip"

if ! command -v secret-tool >/dev/null 2>&1; then
    error "secret-tool not found - should have been installed via libsecret-tools."
    exit 6
fi

TEST_LABEL="setup-keyring-wsl-verify"
TEST_VALUE="ok-$(date +%s)"

if echo "$TEST_VALUE" | secret-tool store \
        --label="$TEST_LABEL" verify-key "$TEST_LABEL" 2>/dev/null; then
    success "Wrote test secret"
else
    error "secret-tool store failed - SecretService not reachable."
    error "Try: wsl --shutdown, reopen, re-run this script."
    exit 7
fi

READ_BACK="$(secret-tool lookup verify-key "$TEST_LABEL" 2>/dev/null || true)"
if [[ "$READ_BACK" == "$TEST_VALUE" ]]; then
    success "Read test secret back: round-trip works"
    secret-tool clear verify-key "$TEST_LABEL" 2>/dev/null || true
    log "Test secret cleared"
else
    error "Read-back mismatch. Expected '$TEST_VALUE', got '$READ_BACK'"
    exit 8
fi

# ---- 10. Done ----
step "Setup complete"
cat <<'EOF'

What just happened:
  - systemd is enabled and running in WSL2
  - gnome-keyring + libsecret are installed
  - A passwordless login keyring exists at ~/.local/share/keyrings/login.keyring
  - A bashrc hook auto-starts SecretService for every new shell
  - secret-tool can write and read secrets via the SecretService

Next steps:
  1. Open a fresh terminal (or 'source ~/.bashrc')
  2. Run: agy
  3. Complete the browser OAuth flow once
  4. Close and reopen the terminal - agy should NOT re-prompt

If agy still re-prompts, capture this diagnostic and file an issue:
  pgrep -u "$USER" -a gnome-keyring-daemon
  gdbus introspect --session --dest org.freedesktop.secrets --object-path /org/freedesktop/secrets
  echo "DBUS_SESSION_BUS_ADDRESS=$DBUS_SESSION_BUS_ADDRESS"

EOF

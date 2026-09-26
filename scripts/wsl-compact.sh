#!/usr/bin/env bash

set -Eeuo pipefail
IFS=$'\n\t'

usage() {
  cat <<'EOF'
Compact one WSL 2 distribution's VHDX on Windows.

Usage:
  bash scripts/wsl-compact.sh

Run it from Windows Command Prompt (where bash starts WSL), a WSL shell, or
Git Bash, under the Windows account that owns the distribution. Unless Git
Bash is already running as Administrator, the script asks for administrator
approval (UAC) and continues in a new PowerShell window, because compaction
shuts down all running WSL distributions. The menu lists WSL 2 distributions
with a VHDX, and DiskPart compacts only the selected virtual disk.

No disk is changed until you select a distribution and type its exact name.
Close Docker Desktop and WSL terminals before confirming.
EOF
}

die() {
  printf '[ERR] %s\n' "$*" >&2
  exit 1
}

if (( $# > 0 )); then
  case "$1" in
    -h|--help)
      (( $# == 1 )) || die "--help does not accept other options."
      usage
      exit 0
      ;;
    *) die "Unknown option: $1 (use --help)." ;;
  esac
fi

is_wsl() {
  [[ -n "${WSL_DISTRO_NAME:-}" || -n "${WSL_INTEROP:-}" ]] && return 0
  [[ -r /proc/sys/kernel/osrelease ]] && grep -qi 'microsoft' /proc/sys/kernel/osrelease
}

case "$(uname -s)" in
  MINGW*|MSYS*) platform=git-bash ;;
  Linux)
    is_wsl || die "Run this script from Windows Command Prompt, WSL, or Git Bash on Windows."
    platform=wsl
    ;;
  *) die "Run this script from Windows Command Prompt, WSL, or Git Bash on Windows." ;;
esac

[[ -t 0 ]] || die "An interactive terminal is required."
powershell="$(command -v powershell.exe || true)"
if [[ -z "$powershell" && "$platform" == wsl ]]; then
  # WSL can leave Windows directories off PATH (appendWindowsPath=false).
  powershell="$(wslpath -u 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' 2>/dev/null || true)"
fi
[[ -n "$powershell" && -x "$powershell" ]] \
  || die "powershell.exe was not found on the Windows PATH."

compaction_code="$(cat <<'POWERSHELL'
$ErrorActionPreference = 'Stop'

try {
    Set-Location -LiteralPath ([IO.Path]::GetTempPath())
    foreach ($command in @('wsl.exe', 'diskpart.exe')) {
        if (-not (Get-Command -Name $command -ErrorAction SilentlyContinue)) {
            throw "$command was not found on the Windows PATH."
        }
    }

    $registryRoot = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Lxss'
    if (-not (Test-Path -LiteralPath $registryRoot)) {
        throw 'No WSL distributions were found for this Windows account.'
    }

    $distros = @()
    foreach ($key in (Get-ChildItem -LiteralPath $registryRoot)) {
        $name = [string]($key.GetValue('DistributionName', ''))
        $version = [int]($key.GetValue('Version', 0))
        $basePath = [Environment]::ExpandEnvironmentVariables(
            [string]($key.GetValue('BasePath', ''))
        )
        if ($version -ne 2 -or [string]::IsNullOrWhiteSpace($name) -or
            -not [IO.Path]::IsPathRooted($basePath)) {
            continue
        }

        $vhdFileName = [string]($key.GetValue('VhdFileName', 'ext4.vhdx'))
        # A VhdFileName with directory parts is skipped, so a listed VHDX always sits directly in its distribution's BasePath.
        if (-not $vhdFileName.EndsWith('.vhdx', [StringComparison]::OrdinalIgnoreCase) -or
            [IO.Path]::GetFileName($vhdFileName) -cne $vhdFileName) {
            continue
        }
        $vhdPath = [IO.Path]::Combine($basePath, $vhdFileName)
        if (-not [IO.File]::Exists($vhdPath)) {
            continue
        }
        $vhd = [IO.FileInfo]::new($vhdPath)
        $distros += [pscustomobject]@{
            Name = $name
            RegistryKey = $key.PSPath
            VhdFileName = $vhdFileName
            Path = $vhd.FullName
            Bytes = $vhd.Length
        }
    }
    $distros = @($distros | Sort-Object -Property Name)
    if ($distros.Count -eq 0) {
        throw 'No WSL 2 VHDX files were found for this Windows account.'
    }

    while ($true) {
        Write-Host "`nWSL virtual disk compaction"
        for ($i = 0; $i -lt $distros.Count; $i++) {
            $distro = $distros[$i]
            Write-Host ('  {0}) {1} ({2:N2} GiB)' -f ($i + 1), $distro.Name, ($distro.Bytes / 1GB))
        }
        Write-Host '  q) Quit'
        $choice = Read-Host 'Choose a distribution'
        if ($choice -match '^[Qq]$') {
            Write-Host 'Cancelled; no files were changed.'
            exit 0
        }

        $index = 0
        if ([int]::TryParse($choice, [ref]$index) -and
            $index -ge 1 -and $index -le $distros.Count) {
            $selected = $distros[$index - 1]
            break
        }
        Write-Host 'Choose a listed number or q.'
    }

    Write-Host ("`nSelected: {0}" -f $selected.Name)
    Write-Host ('VHDX: {0}' -f $selected.Path)
    Write-Host ('Current file size: {0:N2} GiB' -f ($selected.Bytes / 1GB))
    Write-Host 'This will stop ALL WSL distributions, including Docker Desktop WSL sessions.'
    Write-Host 'Close Docker Desktop and WSL terminals before continuing.'
    $confirmation = Read-Host ('Type {0} to compact this VHDX' -f $selected.Name)
    if ($confirmation -cne $selected.Name) {
        Write-Host 'Cancelled; no files were changed.'
        exit 0
    }

    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Administrator rights are required to compact the VHDX.'
    }

    $key = Get-Item -LiteralPath $selected.RegistryKey
    $basePath = [Environment]::ExpandEnvironmentVariables(
        [string]($key.GetValue('BasePath', ''))
    )
    $vhdFileName = [string]($key.GetValue('VhdFileName', 'ext4.vhdx'))
    $currentPath = [IO.Path]::Combine($basePath, $vhdFileName)
    $currentVhd = [IO.FileInfo]::new($currentPath)
    if ([int]($key.GetValue('Version', 0)) -ne 2 -or
        [string]($key.GetValue('DistributionName', '')) -cne $selected.Name -or
        $vhdFileName -cne $selected.VhdFileName -or
        -not $currentVhd.Exists -or
        -not [string]::Equals($currentVhd.FullName, $selected.Path,
            [StringComparison]::OrdinalIgnoreCase)) {
        throw 'The selected distribution changed after the menu; refusing compaction.'
    }
    # DiskPart /s reads an ASCII script; UTF-16 input makes it print help and fail.
    if ($selected.Path -match '[\r\n"]' -or $selected.Path -match '[^\x20-\x7E]') {
        throw 'The VHDX path cannot be represented safely in a DiskPart script.'
    }
    $diskpartPath = $selected.Path
    # Registrations such as Docker Desktop's store BasePath with the \\?\ prefix; DiskPart gets the plain drive-letter path.
    if ($diskpartPath.StartsWith('\\?\', [StringComparison]::Ordinal)) {
        $diskpartPath = $diskpartPath.Substring(4)
        if ($diskpartPath -notmatch '^[A-Za-z]:\\') {
            throw 'DiskPart requires a drive-letter path for this VHDX.'
        }
    }

    Write-Host 'Shutting down WSL...'
    & wsl.exe --shutdown
    if ($LASTEXITCODE -ne 0) {
        throw "wsl.exe --shutdown failed with exit code $LASTEXITCODE."
    }

    $beforeBytes = ([IO.FileInfo]::new($selected.Path)).Length
    $diskpartScript = New-TemporaryFile
    try {
        $diskpartCommands = @(
            ('select vdisk file="{0}"' -f $diskpartPath)
            'compact vdisk'
        )
        Set-Content -LiteralPath $diskpartScript.FullName -Value $diskpartCommands -Encoding ASCII
        Write-Host 'Compacting the selected VHDX with DiskPart...'
        & diskpart.exe /s $diskpartScript.FullName
        $diskpartExit = $LASTEXITCODE
    }
    finally {
        Remove-Item -LiteralPath $diskpartScript.FullName -Force -ErrorAction SilentlyContinue
    }
    if ($diskpartExit -ne 0) {
        throw "DiskPart failed with exit code $diskpartExit."
    }

    $afterBytes = ([IO.FileInfo]::new($selected.Path)).Length
    Write-Host ('Before: {0:N2} GiB' -f ($beforeBytes / 1GB))
    Write-Host ('After:  {0:N2} GiB' -f ($afterBytes / 1GB))
    if ($afterBytes -lt $beforeBytes) {
        Write-Host ('Reclaimed: {0:N2} GiB' -f (($beforeBytes - $afterBytes) / 1GB))
    }
    else {
        Write-Host 'DiskPart completed, but the VHDX file size did not decrease.'
    }
    exit 0
}
catch {
    [Console]::Error.WriteLine('[ERR] ' + $_.Exception.Message)
    exit 1
}
finally {
    # The elevated-window handoff sets $holdWindow; its window closes on exit before the result can be read.
    if ($holdWindow) {
        Read-Host 'Press Enter to close' | Out-Null
    }
}
POWERSHELL
)"

# fltmc.exe exits 0 only in an elevated session, so elevated Git Bash compacts in this terminal.
# Other launches continue in a new elevated PowerShell window after UAC approval; it keeps running when wsl --shutdown ends a WSL launch.
if [[ "$platform" == git-bash ]] && fltmc.exe >/dev/null 2>&1; then
  MSYS_NO_PATHCONV=1 "$powershell" -NoLogo -NoProfile -Command "$compaction_code"
  exit
fi

# -EncodedCommand is base64 UTF-16LE, so the script passes through both command lines without quoting.
# shellcheck disable=SC2016  # $holdWindow is PowerShell source, not a Bash expansion.
encoded="$(printf '$holdWindow = $true\n%s' "$compaction_code" | iconv -f UTF-8 -t UTF-16LE | base64 -w 0)"
launch_template="$(cat <<'POWERSHELL'
$ErrorActionPreference = 'Stop'
try {
    Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -Verb RunAs -ArgumentList @(
        '-NoLogo', '-NoProfile', '-EncodedCommand', 'ENCODED_COMMAND'
    )
}
catch {
    [Console]::Error.WriteLine('[ERR] ' + $_.Exception.Message)
    exit 1
}
POWERSHELL
)"

printf 'Requesting administrator approval...\n'
MSYS_NO_PATHCONV=1 "$powershell" -NoLogo -NoProfile -Command "${launch_template/ENCODED_COMMAND/$encoded}" \
  || die "The administrator window did not open; no files were changed."
printf 'Continuing in the administrator PowerShell window.\n'

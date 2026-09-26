#!/usr/bin/env bash

set -Eeuo pipefail
IFS=$'\n\t'

usage() {
  cat <<'EOF'
Compact one WSL 2 distribution's VHDX from Git Bash on Windows.

Usage:
  bash scripts/wsl-compact.sh

Run interactively in Git Bash as an administrator under the Windows account
that owns the distribution. The menu lists WSL 2 distributions with a VHDX.
Compaction shuts down all running WSL distributions, then uses DiskPart to
compact only the selected virtual disk.

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

case "$(uname -s)" in
  MINGW*|MSYS*) ;;
  *) die "Run this script from Git Bash on Windows, outside WSL." ;;
esac

[[ -t 0 ]] || die "An interactive Git Bash terminal is required."
command -v powershell.exe >/dev/null 2>&1 \
  || die "powershell.exe was not found on the Windows PATH."

powershell_code="$(cat <<'POWERSHELL'
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
        throw 'Run Git Bash as Administrator under the Windows account that owns this distribution.'
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
        $commands = @(
            ('select vdisk file="{0}"' -f $diskpartPath)
            'compact vdisk'
        )
        Set-Content -LiteralPath $diskpartScript.FullName -Value $commands -Encoding ASCII
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
POWERSHELL
)"

MSYS_NO_PATHCONV=1 powershell.exe -NoLogo -NoProfile -Command "$powershell_code"

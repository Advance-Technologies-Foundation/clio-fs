param(
  [switch]$Force
)

$ErrorActionPreference = "Stop"

$InstallRoot = if ($env:CLIO_FS_SERVER_INSTALL_ROOT) { $env:CLIO_FS_SERVER_INSTALL_ROOT } else { "C:\Program Files\ClioFS\server" }
$ForceUninstall = $Force.IsPresent -or $env:CLIO_FS_FORCE_UNINSTALL -eq "1"
$AppName = "clio-fs-server"

function Confirm-Uninstall {
  if ($ForceUninstall) {
    return
  }

  if (-not [Environment]::UserInteractive) {
    throw "Refusing to uninstall $AppName without confirmation. Re-run with -Force or CLIO_FS_FORCE_UNINSTALL=1."
  }

  $response = Read-Host "Uninstall $AppName from $InstallRoot? This removes releases, config, and state [y/N]"
  if ($response -notmatch '^(?i:y(?:es)?)$') {
    throw "Uninstall cancelled."
  }
}

function Remove-PathIfPresent {
  param([string]$Path)

  if (Test-Path -LiteralPath $Path) {
    Remove-Item -LiteralPath $Path -Recurse -Force
  }
}

if (-not (Test-Path -LiteralPath $InstallRoot)) {
  Write-Host "$AppName is not installed at $InstallRoot"
  exit 0
}

Confirm-Uninstall

Remove-PathIfPresent (Join-Path $InstallRoot "current")
Remove-PathIfPresent (Join-Path $InstallRoot "releases")
Remove-PathIfPresent (Join-Path $InstallRoot "config")
Remove-PathIfPresent (Join-Path $InstallRoot "data")

try {
  Remove-Item -LiteralPath $InstallRoot -Force
  Write-Host "Removed empty install root $InstallRoot"
} catch {
  if (Test-Path -LiteralPath $InstallRoot) {
    $remainingEntries = Get-ChildItem -LiteralPath $InstallRoot -Force -ErrorAction SilentlyContinue
    if (-not $remainingEntries) {
      Remove-Item -LiteralPath $InstallRoot -Recurse -Force
      Write-Host "Removed empty install root $InstallRoot"
    }
  }
}

Write-Host "Uninstalled $AppName from $InstallRoot"

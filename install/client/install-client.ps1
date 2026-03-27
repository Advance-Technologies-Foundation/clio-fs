$ErrorActionPreference = "Stop"

$Repository = if ($env:CLIO_FS_GITHUB_REPOSITORY) { $env:CLIO_FS_GITHUB_REPOSITORY } else { "Advance-Technologies-Foundation/clio-fs" }
$InstallRoot = if ($env:CLIO_FS_CLIENT_INSTALL_ROOT) { $env:CLIO_FS_CLIENT_INSTALL_ROOT } else { "C:\Program Files\ClioFS\client" }
$AppDirName = "clio-fs-client"

function Normalize-Tag {
  param([string]$Value)

  if ($Value.StartsWith("v")) {
    return $Value
  }

  return "v$Value"
}

function Copy-IfMissing {
  param(
    [string]$SourcePath,
    [string]$DestinationPath
  )

  if ((Test-Path -LiteralPath $SourcePath) -and -not (Test-Path -LiteralPath $DestinationPath)) {
    Copy-Item -LiteralPath $SourcePath -Destination $DestinationPath
  }
}

if ($env:CLIO_FS_VERSION) {
  $ReleaseTag = Normalize-Tag $env:CLIO_FS_VERSION
} else {
  $LatestRelease = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repository/releases/latest"
  if (-not $LatestRelease.tag_name) {
    throw "Unable to resolve latest release tag for $Repository"
  }
  $ReleaseTag = [string]$LatestRelease.tag_name
}

$ReleaseVersion = $ReleaseTag.TrimStart("v")
$AssetName = "clio-fs-$ReleaseTag-windows.zip"
$DownloadUrl = "https://github.com/$Repository/releases/download/$ReleaseTag/$AssetName"
$TempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("clio-fs-client-install-" + [System.Guid]::NewGuid().ToString("N"))
$ArchivePath = Join-Path $TempRoot $AssetName
$ExtractRoot = Join-Path $TempRoot "extract"
$SourceDir = Join-Path $ExtractRoot "$AppDirName-$ReleaseTag"
$ReleaseRoot = Join-Path $InstallRoot "releases\$ReleaseVersion"
$CurrentPath = Join-Path $InstallRoot "current"
$SharedConfigDir = Join-Path $InstallRoot "config"
$SharedDataDir = Join-Path $InstallRoot "data"
$SharedStateDir = Join-Path $SharedDataDir ".clio-fs"

try {
  New-Item -ItemType Directory -Force -Path $TempRoot | Out-Null
  Write-Host "Downloading $DownloadUrl"
  Invoke-WebRequest -Uri $DownloadUrl -OutFile $ArchivePath
  Expand-Archive -LiteralPath $ArchivePath -DestinationPath $ExtractRoot -Force

  if (-not (Test-Path -LiteralPath $SourceDir)) {
    throw "Release archive did not contain $AppDirName-$ReleaseTag"
  }

  if (Test-Path -LiteralPath $ReleaseRoot) {
    throw "Install target already exists: $ReleaseRoot"
  }

  New-Item -ItemType Directory -Force -Path (Join-Path $InstallRoot "releases"), $SharedConfigDir, $SharedStateDir | Out-Null
  Copy-Item -LiteralPath $SourceDir -Destination $ReleaseRoot -Recurse

  Remove-Item -LiteralPath (Join-Path $ReleaseRoot "config") -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path $ReleaseRoot ".clio-fs") -Recurse -Force -ErrorAction SilentlyContinue

  New-Item -ItemType Junction -Path (Join-Path $ReleaseRoot "config") -Target $SharedConfigDir | Out-Null
  New-Item -ItemType Junction -Path (Join-Path $ReleaseRoot ".clio-fs") -Target $SharedStateDir | Out-Null

  Copy-IfMissing (Join-Path $SourceDir "config\shared.conf.example") (Join-Path $SharedConfigDir "shared.conf")
  Copy-IfMissing (Join-Path $SourceDir "config\client.conf.example") (Join-Path $SharedConfigDir "client.conf")
  Copy-IfMissing (Join-Path $SourceDir "config\client-ui.conf.example") (Join-Path $SharedConfigDir "client-ui.conf")

  if (Test-Path -LiteralPath $CurrentPath) {
    Remove-Item -LiteralPath $CurrentPath -Recurse -Force
  }

  New-Item -ItemType Junction -Path $CurrentPath -Target $ReleaseRoot | Out-Null

  Write-Host "Installed $AppDirName $ReleaseVersion"
  Write-Host "Current release: $CurrentPath"
  Write-Host "Config directory: $SharedConfigDir"
  Write-Host "State directory: $SharedStateDir"
  Write-Host "Next step: edit $SharedConfigDir\client.conf and start $CurrentPath\clio-fs-client.cmd"
} finally {
  if (Test-Path -LiteralPath $TempRoot) {
    Remove-Item -LiteralPath $TempRoot -Recurse -Force
  }
}

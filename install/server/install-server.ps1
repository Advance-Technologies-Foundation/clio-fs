$ErrorActionPreference = "Stop"

$Repository = if ($env:CLIO_FS_GITHUB_REPOSITORY) { $env:CLIO_FS_GITHUB_REPOSITORY } else { "Advance-Technologies-Foundation/clio-fs" }
$InstallRoot = if ($env:CLIO_FS_SERVER_INSTALL_ROOT) { $env:CLIO_FS_SERVER_INSTALL_ROOT } else { "C:\Program Files\ClioFS\server" }
$AppDirName = "clio-fs-server"
$DefaultServerHost = if ($env:CLIO_FS_SERVER_HOST) { $env:CLIO_FS_SERVER_HOST } else { "0.0.0.0" }
$DefaultServerPort = if ($env:CLIO_FS_SERVER_PORT) { $env:CLIO_FS_SERVER_PORT } else { "4020" }

function Normalize-Version {
  param([string]$Value)

  if ($Value.StartsWith("v")) {
    return $Value.Substring(1)
  }

  return $Value
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

function Test-ValidPort {
  param([string]$Value)

  $parsed = 0
  if (-not [int]::TryParse($Value, [ref]$parsed)) {
    return $false
  }

  return $parsed -ge 1 -and $parsed -le 65535
}

function Read-ServerPort {
  param([string]$DefaultPort)

  if ($env:CLIO_FS_SERVER_PORT) {
    if (-not (Test-ValidPort $env:CLIO_FS_SERVER_PORT)) {
      throw "Invalid CLIO_FS_SERVER_PORT: $($env:CLIO_FS_SERVER_PORT)"
    }

    return $env:CLIO_FS_SERVER_PORT
  }

  if (-not [Environment]::UserInteractive) {
    Write-Host "No interactive terminal detected; using default server port $DefaultPort"
    return $DefaultPort
  }

  while ($true) {
    $entered = Read-Host "Server port [default $DefaultPort]"
    if ([string]::IsNullOrWhiteSpace($entered)) {
      $entered = $DefaultPort
    }

    if (Test-ValidPort $entered) {
      return $entered
    }

    Write-Host "Port must be an integer between 1 and 65535."
  }
}

function Initialize-ServerConfig {
  param(
    [string]$ConfigPath,
    [string]$Host,
    [string]$Port
  )

  $lines = Get-Content -LiteralPath $ConfigPath
  $hostWritten = $false
  $portWritten = $false
  $updatedLines = foreach ($line in $lines) {
    if ($line -match '^CLIO_FS_SERVER_HOST=') {
      $hostWritten = $true
      "CLIO_FS_SERVER_HOST=$Host"
      continue
    }

    if ($line -match '^CLIO_FS_SERVER_PORT=') {
      $portWritten = $true
      "CLIO_FS_SERVER_PORT=$Port"
      continue
    }

    $line
  }

  if (-not $hostWritten) {
    $updatedLines += "CLIO_FS_SERVER_HOST=$Host"
  }

  if (-not $portWritten) {
    $updatedLines += "CLIO_FS_SERVER_PORT=$Port"
  }

  Set-Content -LiteralPath $ConfigPath -Value $updatedLines -Encoding utf8
}

if ($env:CLIO_FS_VERSION) {
  $ReleaseTag = Normalize-Version $env:CLIO_FS_VERSION
} else {
  $LatestRelease = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repository/releases/latest"
  if (-not $LatestRelease.tag_name) {
    throw "Unable to resolve latest release tag for $Repository"
  }
  $ReleaseTag = [string]$LatestRelease.tag_name
}

$ReleaseVersion = Normalize-Version $ReleaseTag
$ReleaseTag = $ReleaseVersion
$AssetName = "clio-fs-$ReleaseVersion-windows.zip"
$DownloadUrl = "https://github.com/$Repository/releases/download/$ReleaseTag/$AssetName"
$TempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("clio-fs-server-install-" + [System.Guid]::NewGuid().ToString("N"))
$ArchivePath = Join-Path $TempRoot $AssetName
$ExtractRoot = Join-Path $TempRoot "extract"
$SourceDir = Join-Path $ExtractRoot "$AppDirName-$ReleaseVersion"
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

  $IsFreshInstall = -not (Test-Path -LiteralPath (Join-Path $SharedConfigDir "server.conf"))

  Copy-IfMissing (Join-Path $SourceDir "config\shared.conf.example") (Join-Path $SharedConfigDir "shared.conf")
  Copy-IfMissing (Join-Path $SourceDir "config\server.conf.example") (Join-Path $SharedConfigDir "server.conf")

  if ($IsFreshInstall) {
    if (-not (Test-ValidPort $DefaultServerPort)) {
      throw "Invalid default server port: $DefaultServerPort"
    }

    $SelectedPort = Read-ServerPort -DefaultPort $DefaultServerPort
    Initialize-ServerConfig -ConfigPath (Join-Path $SharedConfigDir "server.conf") -Host $DefaultServerHost -Port $SelectedPort
    Write-Host "Initialized $SharedConfigDir\server.conf with host $DefaultServerHost and port $SelectedPort"
  }

  if (Test-Path -LiteralPath $CurrentPath) {
    Remove-Item -LiteralPath $CurrentPath -Recurse -Force
  }

  New-Item -ItemType Junction -Path $CurrentPath -Target $ReleaseRoot | Out-Null

  Write-Host "Installed $AppDirName $ReleaseVersion"
  Write-Host "Current release: $CurrentPath"
  Write-Host "Config directory: $SharedConfigDir"
  Write-Host "State directory: $SharedStateDir"
  Write-Host "Next step: edit $SharedConfigDir\server.conf and start $CurrentPath\clio-fs-server.cmd"
} finally {
  if (Test-Path -LiteralPath $TempRoot) {
    Remove-Item -LiteralPath $TempRoot -Recurse -Force
  }
}

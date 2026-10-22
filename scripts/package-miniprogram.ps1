$ErrorActionPreference = 'Stop'
$projectRootPath = Split-Path -Parent $PSScriptRoot
$miniSourcePath = Join-Path $projectRootPath 'miniprogram'
$artifactOutputPath = Join-Path $projectRootPath 'artifacts'
$zipOutputPath = Join-Path $artifactOutputPath 'chisha-miniprogram.zip'
if (!(Test-Path -LiteralPath (Join-Path $miniSourcePath 'app.json'))) { throw 'Missing mini program source.' }
New-Item -ItemType Directory -Path $artifactOutputPath -Force | Out-Null
# Package only the app folder. Local private tool settings are excluded.
$archiveEntries = Get-ChildItem -LiteralPath $miniSourcePath -Force | Where-Object { $_.Name -ne 'project.private.config.json' }
Compress-Archive -LiteralPath $archiveEntries.FullName -DestinationPath $zipOutputPath -Force
Write-Output $zipOutputPath

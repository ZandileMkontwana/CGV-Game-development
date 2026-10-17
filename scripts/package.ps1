param(
    [string]$ArchiveName = 'CodeCrafters.zip'
)

$ErrorActionPreference = 'Stop'
if ([System.IO.Path]::GetFileName($ArchiveName) -ne $ArchiveName -or
    $ArchiveName -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*\.zip$') {
    throw 'ArchiveName must be a ZIP filename without directories or spaces.'
}
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $projectRoot
try {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Build failed; no submission package created.' }
    $buildDirectory = Join-Path $projectRoot 'dist'
    if (-not (Test-Path -LiteralPath (Join-Path $buildDirectory 'index.html'))) {
        throw 'The build has no index.html.'
    }
    $outputDirectory = Join-Path $projectRoot 'submission'
    New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
    $archivePath = Join-Path $outputDirectory $ArchiveName
    # Store forward-slash entries so the package extracts correctly on Ubuntu.
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archiveStream = [System.IO.File]::Open($archivePath, [System.IO.FileMode]::Create)
    $archive = [System.IO.Compression.ZipArchive]::new($archiveStream, [System.IO.Compression.ZipArchiveMode]::Create, $false)
    try {
        foreach ($item in (Get-ChildItem -LiteralPath $buildDirectory -Recurse -File)) {
            $relativeName = $item.FullName.Substring($buildDirectory.Length + 1).Replace('\', '/')
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $item.FullName, $relativeName, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
        }
    } finally {
        $archive.Dispose()
        $archiveStream.Dispose()
    }
    Write-Output "Submission package: $archivePath"
} finally {
    Pop-Location
}

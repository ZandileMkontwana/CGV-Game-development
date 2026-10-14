$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$projectRoot = Split-Path -Parent $PSScriptRoot
$audioDirectory = Join-Path $projectRoot 'src/assets/audio'
New-Item -ItemType Directory -Path $audioDirectory -Force | Out-Null
$announcements = @{
    'pa-dispatch' = 'Engineering call. Auxiliary power offline in Lab A 2. Enter the laboratory and pulse the amber relay.'
    'pa-power' = 'Auxiliary power restored. Resuming culture protocol.'
    'pa-bypass' = 'Emergency bypass released. Follow the green route to the control room and release the exits.'
    'pa-breach' = 'Warning. Containment breach detected. Lockdown initiated.'
    'pa-failsafe' = 'Failsafe protocol active. Structural demolition in T minus fifteen minutes.'
    'pa-demolition' = 'Demolition sequence engaged. Evacuate immediately.'
}
$synthesizer = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $synthesizer.SelectVoice('Microsoft Zira Desktop')
    $synthesizer.Rate = -1
    foreach ($name in $announcements.Keys) {
        $synthesizer.SetOutputToWaveFile((Join-Path $audioDirectory ($name + '.wav')))
        $synthesizer.Speak($announcements[$name])
        $synthesizer.SetOutputToNull()
    }
} finally {
    $synthesizer.Dispose()
}
Write-Output 'Generated the temporary PA clips. See ASSET_CREDITS.md for attribution status.'

<#
.SYNOPSIS
  Capture review screenshots of a web UI with headless Edge or Chrome.
.EXAMPLE
  ./shoot.ps1 -Url 'http://127.0.0.1:8787/#demo' -OutDir "$review\round0" -Round 0
.EXAMPLE
  ./shoot.ps1 -Url http://localhost:3000/ -OutDir ./review/round2 -Round 2 -Viewports @(
    @{ name = 'desktop-fold'; width = 1440; height = 900 },
    @{ name = 'mobile'; width = 390; height = 1800 })
#>
param(
  [Parameter(Mandatory)] [string] $Url,
  [Parameter(Mandatory)] [string] $OutDir,
  [int] $Round = -1,
  [hashtable[]] $Viewports = @(
    @{ name = 'desktop-full'; width = 1440; height = 3200 },
    @{ name = 'desktop-fold'; width = 1440; height = 900 },
    @{ name = 'narrow'; width = 820; height = 2400 }
  ),
  [int] $SettleMs = 4000,
  [string] $Browser
)
$ErrorActionPreference = 'Stop'

if (-not $Browser) {
  $candidates = @(
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ) + @('microsoft-edge', 'google-chrome', 'chromium') | ForEach-Object {
    if ($_ -and (Test-Path $_ -ErrorAction SilentlyContinue)) { $_ }
    elseif ($_ -and (Get-Command $_ -ErrorAction SilentlyContinue)) { (Get-Command $_).Source }
  }
  $Browser = $candidates | Select-Object -First 1
  if (-not $Browser) { throw 'No Edge or Chrome found; pass -Browser <path>.' }
}

# Cache-bust per round (?r=N) before any #fragment so each round loads fresh assets.
if ($Round -ge 0) {
  $hash = ''
  $base = $Url
  $i = $Url.IndexOf('#')
  if ($i -ge 0) { $base = $Url.Substring(0, $i); $hash = $Url.Substring($i) }
  $sep = if ($base.Contains('?')) { '&' } else { '?' }
  $Url = "$base${sep}r=$Round$hash"
}

New-Item -ItemType Directory -Force $OutDir | Out-Null
$profileDir = Join-Path ([IO.Path]::GetTempPath()) 'design-panel-review-browser'
foreach ($v in $Viewports) {
  $out = Join-Path (Resolve-Path $OutDir) "$($v.name).png"
  & $Browser --headless=new --disable-gpu --hide-scrollbars --no-first-run `
    "--user-data-dir=$profileDir" "--virtual-time-budget=$SettleMs" `
    "--window-size=$($v.width),$($v.height)" "--screenshot=$out" $Url 2>$null | Out-Null
  Start-Sleep -Milliseconds 500
  if (-not (Test-Path $out)) { throw "Screenshot not written: $out" }
  '{0}  {1:N0} bytes' -f $out, (Get-Item $out).Length
}

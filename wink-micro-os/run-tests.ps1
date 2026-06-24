<#
.SYNOPSIS
  wink-micro-os host tests (unit + end-to-end) one-click runner.
.DESCRIPTION
  Builds and runs all host tests with WinLibs MinGW (gcc) + cmake on your PC.
  No real hardware / browser needed.
  Usage:
    pwsh ./run-tests.ps1          # incremental build + run tests (fast, daily)
    pwsh ./run-tests.ps1 -Clean   # wipe build-test and full rebuild
    pwsh ./run-tests.ps1 -Detailed # also print each test exe's full output
#>
[CmdletBinding()]
param(
    [switch]$Clean,
    [switch]$Detailed
)

$ErrorActionPreference = 'Stop'

# ---- 1. Locate toolchain (WinLibs MinGW: gcc 16.1.0 + cmake 4.3.2) ----
$toolchain = "C:\Users\77174\AppData\Local\Microsoft\WinGet\Packages\BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe\mingw64\bin"
if (Test-Path $toolchain) {
    $env:PATH = "$toolchain;$env:PATH"
}

# ---- 2. Verify toolchain present ----
foreach ($t in 'gcc','cmake') {
    if (-not (Get-Command $t -ErrorAction SilentlyContinue)) {
        Write-Host "[FAIL] '$t' not found. Check WinLibs install, or open a NEW PowerShell window so PATH refreshes." -ForegroundColor Red
        Write-Host "       Expected path: $toolchain"
        exit 1
    }
}

# ---- 3. cd to this script's dir (i.e. wink-micro-os/) ----
Set-Location $PSScriptRoot
$buildDir = "build-test"

if ($Clean -and (Test-Path $buildDir)) {
    Write-Host "-> Cleaning $buildDir ..." -ForegroundColor Yellow
    Remove-Item -Recurse -Force $buildDir
}

# ---- 4. Configure ----
Write-Host "-> cmake configure (TARGET_PLATFORM=host) ..." -ForegroundColor Cyan
cmake -B $buildDir -DTARGET_PLATFORM=host *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host "[FAIL] configure failed, re-running with full output:" -ForegroundColor Red
    cmake -B $buildDir -DTARGET_PLATFORM=host
    exit 1
}

# ---- 5. Build ----
Write-Host "-> Building ..." -ForegroundColor Cyan
cmake --build $buildDir 2>&1 | Out-Host
if ($LASTEXITCODE -ne 0) { Write-Host "[FAIL] build failed" -ForegroundColor Red; exit 1 }

# ---- 6. Test ----
Write-Host "-> Running tests ..." -ForegroundColor Cyan
Push-Location $buildDir
try {
    if ($Detailed) { ctest --output-on-failure -V } else { ctest --output-on-failure }
    $rc = $LASTEXITCODE
} finally { Pop-Location }

if ($rc -eq 0) {
    Write-Host "`n[PASS] All tests passed" -ForegroundColor Green
} else {
    Write-Host "`n[FAIL] Some tests failed (see output above)" -ForegroundColor Red
}
exit $rc

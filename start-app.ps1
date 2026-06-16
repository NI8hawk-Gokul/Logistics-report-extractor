$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendPython = Join-Path $projectRoot "backend\venv\Scripts\python.exe"

if (-not (Test-Path $backendPython)) {
    throw "Backend environment not found at $backendPython"
}

Write-Host "Building the frontend..."
Push-Location (Join-Path $projectRoot "frontend")
try {
    & node "node_modules\vite\bin\vite.js" build
    if ($LASTEXITCODE -ne 0) {
        throw "Frontend build failed."
    }
}
finally {
    Pop-Location
}

$env:DATABASE_MODE = if ($env:DATABASE_MODE) { $env:DATABASE_MODE } else { "auto" }
Write-Host ""
Write-Host "Smart Logistics is starting at http://127.0.0.1:8080"
Write-Host "Keep this window open while using the application."
Write-Host ""

Push-Location (Join-Path $projectRoot "backend")
try {
    & $backendPython "main.py"
}
finally {
    Pop-Location
}

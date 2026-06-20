<#
.SYNOPSIS
Start backend (port 8765) and frontend (port 5173) together.
Usage: .\dev.ps1
#>

$ROOT = $PSScriptRoot

# --- Override production .env with localhost values for dev ---
$env:ENV = "dev"
$env:OAUTH_REDIRECT_URI = "http://localhost:8765/api/auth/google/callback"
$env:FRONTEND_URL = "http://localhost:5173"
$env:CORS_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173"

# Find Python venv or fall back to system Python
$venv = Join-Path $env:USERPROFILE ".local\venv"
if (Test-Path "$venv\Scripts\python.exe") {
    $PYTHON = "$venv\Scripts\python.exe"
} else {
    $PYTHON = "python"
}
Write-Host ">>> using python: $PYTHON"

# Derive host from OAUTH_REDIRECT_URI
$devHost = "localhost"
if (Test-Path "$ROOT\backend\.env") {
    $line = Get-Content "$ROOT\backend\.env" | Where-Object { $_ -match '^OAUTH_REDIRECT_URI=' } | Select-Object -First 1
    if ($line) {
        $m = [regex]::Match($line, 'OAUTH_REDIRECT_URI=https?://([^:/]+)')
        if ($m.Success) {
            $devHost = $m.Groups[1].Value
        }
    }
}
Write-Host ">>> using host: $devHost"

# Kill anything on the target ports
foreach ($port in 8765, 5173) {
    $conns = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue | Where-Object { $_.State -ne "TimeWait" }
    foreach ($conn in $conns) {
        Write-Host ">>> killing port $port (pid $($conn.OwningProcess))"
        Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
    }
}
Start-Sleep -Milliseconds 500

Write-Host ">>> starting backend on :8765"
$backend = Start-Process -FilePath $PYTHON -ArgumentList "-m", "uvicorn", "app.main:app", "--host", $devHost, "--port", "8765", "--reload" -WorkingDirectory "$ROOT\backend" -PassThru

Write-Host ">>> starting frontend on :5173"
$frontend = Start-Process -FilePath "cmd.exe" -ArgumentList "/k", "cd /d $ROOT\frontend && npx vite --host $devHost --port 5173" -PassThru

Write-Host ""
Write-Host "Backend  http://${devHost}:8765  (docs at /docs)"
Write-Host "Frontend http://${devHost}:5173"
Write-Host ""
Write-Host "Press Enter to stop both servers..."

# Block until user presses Enter, then kill both
try {
    [void][Console]::ReadLine()
} finally {
    Write-Host "Stopping..."
    Stop-Process -Id $backend.Id -Force -ErrorAction SilentlyContinue
    Stop-Process -Id $frontend.Id -Force -ErrorAction SilentlyContinue
    # Also kill any child processes
    Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $frontend.Id } | ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

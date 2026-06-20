@echo off
REM Start backend (port 8765) and frontend (port 5173) for development.
REM Usage: dev.bat

setlocal

set ROOT=%~dp0

set ENV=dev
set OAUTH_REDIRECT_URI=http://localhost:8765/api/auth/google/callback
set FRONTEND_URL=http://localhost:5173
set CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173

if exist "%USERPROFILE%\.local\venv\Scripts\python.exe" (
    set PYTHON=%USERPROFILE%\.local\venv\Scripts\python.exe
) else (
    set PYTHON=python
)

echo Starting backend on port 8765...
start "Backend" cmd /k "cd /d %ROOT%backend ^&^& %PYTHON% -m uvicorn app.main:app --host localhost --port 8765 --reload"

timeout /t 3 /nobreak >NUL

echo Starting frontend on port 5173...
start "Frontend" cmd /k "cd /d %ROOT%frontend ^&^& npx vite --host localhost --port 5173"

echo.
echo Backend  http://localhost:8765  (docs at /docs)
echo Frontend http://localhost:5173
echo.
echo Close both command windows to stop.
endlocal

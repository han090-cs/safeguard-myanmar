@echo off
rem Myanmar Weather - start the dashboard (API + page) and open it in the browser (Windows).
rem Double-click this file in File Explorer. Stop with Ctrl+C or by closing this window.
setlocal
cd /d "%~dp0"
if not defined PORT set "PORT=8000"
set "URL=http://127.0.0.1:%PORT%/"
set "VENV=.venv-win"
set "PYTHONUTF8=1"
echo == Myanmar Weather in %CD%

rem 1. Python environment - created only if missing or broken (separate from the Mac's .venv)
"%VENV%\Scripts\python.exe" -c "import sys" >nul 2>&1
if not errorlevel 1 goto have_venv
py -3 -c "import sys" >nul 2>&1 && set "PY=py -3" && goto make_venv
python -c "import sys" >nul 2>&1 && set "PY=python" && goto make_venv
echo !! Python 3 was not found.
echo    Install it from https://www.python.org/downloads/ - tick "Add python.exe to PATH" - then run this again.
pause
exit /b 1

:make_venv
echo == Creating the Python environment (%VENV%) with %PY%
%PY% -m venv --clear "%VENV%"
if errorlevel 1 goto fail_venv

:have_venv
set "PYX=%VENV%\Scripts\python.exe"
"%PYX%" --version

rem 2. Packages - quick when already installed
echo == Checking packages...
"%PYX%" -m pip install -q --disable-pip-version-check -r requirements.txt
if errorlevel 1 goto fail_pip

rem 3. Is the port free?
"%PYX%" tools\launch_helper.py port-in-use %PORT%
if errorlevel 1 goto port_free
echo !! Port %PORT% is already in use - the dashboard may already be running: %URL%
start "" "%URL%"
pause
exit /b 0

:port_free
rem 4. Open the browser as soon as the server answers, then run the server in this window
start "" /b "%PYX%" tools\launch_helper.py open-when-ready %URL%
echo == Starting on %URL%  (Ctrl+C to stop)
"%PYX%" -m uvicorn dev_server:app --host 127.0.0.1 --port %PORT%
echo == Server stopped.
pause
exit /b 0

:fail_venv
echo !! Could not create %VENV% - see the message above.
pause
exit /b 1

:fail_pip
echo !! Package install failed - see the message above.
pause
exit /b 1

@echo off
REM ============================================================
REM  Gestionnaire MAF — serveur local de test
REM  Double-cliquer : installe Flask si besoin et lance le serveur
REM  Appli : http://localhost:5000   (autres PC du reseau : http://<IP de ce PC>:5000)
REM ============================================================
cd /d "%~dp0"
where python >nul 2>nul
if errorlevel 1 (
  echo Python introuvable. Installer Python 3 depuis python.org en cochant "Add python to PATH".
  pause
  exit /b 1
)
python -m pip install -q -r requirements.txt
set MAIL_MODE=file
set PYTHONIOENCODING=utf-8
set PYTHONUTF8=1
python server.py
pause

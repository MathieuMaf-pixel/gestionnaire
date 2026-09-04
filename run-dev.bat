@echo off
REM Serveur local en mode developpement : rechargement automatique quand server.py change
cd /d "%~dp0"
python -m pip install -q -r requirements.txt
set MAIL_MODE=file
set PYTHONIOENCODING=utf-8
set PYTHONUTF8=1
set DEBUG=1
python server.py
pause

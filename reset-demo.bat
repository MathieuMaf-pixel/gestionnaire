@echo off
REM Remet la base de test a zero avec le jeu de demonstration (identique sur tous les PC).
REM ARRETER LE SERVEUR AVANT (fermer la fenetre run.bat).
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
set PYTHONUTF8=1
python demo.py reset
pause

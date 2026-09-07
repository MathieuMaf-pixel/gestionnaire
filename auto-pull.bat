@echo off
REM ============================================================
REM  Auto-pull : recupere automatiquement le travail du collegue
REM  (git pull toutes les 30 s, uniquement si aucune collision
REM   avec vos modifications locales). A lancer a cote du serveur.
REM  Fermer la fenetre pour arreter.
REM ============================================================
cd /d "%~dp0"
where git >nul 2>nul || (echo Git introuvable : installer Git for Windows ou GitHub Desktop. & pause & exit /b 1)
title Auto-pull Gestionnaire
:boucle
git fetch -q origin 2>nul
for /f %%i in ('git rev-list --count HEAD..origin/main 2^>nul') do set NEW=%%i
if "%NEW%"=="" set NEW=0
if not "%NEW%"=="0" (
  echo [%time:~0,8%] %NEW% nouveau(x) commit(s) du collegue - mise a jour...
  git pull -q --ff-only origin main
  if errorlevel 1 (
    echo [%time:~0,8%] !! Impossible de mettre a jour automatiquement : vous avez des modifications
    echo     locales sur des fichiers concernes. Faire Commit puis Pull dans GitHub Desktop.
  ) else (
    echo [%time:~0,8%] OK - F5 dans le navigateur. Derniers changements :
    git log -%NEW% --pretty=format:"      %%an : %%s" HEAD
    echo.
  )
) else (
  echo [%time:~0,8%] a jour
)
timeout /t 30 /nobreak >nul
goto boucle

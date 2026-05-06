@echo off
echo Iniciando servidor QA Dashboard em http://localhost:3000
echo Pressione Ctrl+C para parar.
start "" http://localhost:3000
python -m http.server 3000
pause

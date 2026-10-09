@echo off
rem ============================================================
rem   Farias Troca de Oleo - sobe a API
rem
rem   So sobe. Nao derruba nada, nao mata processo, nao mexe em
rem   tarefa agendada. Para reiniciar depois de atualizar os
rem   arquivos, use o REINICIAR.bat.
rem
rem   Uma coisa ele confere antes: se a API JA estiver no ar
rem   naquela porta, ele avisa e sai sem fazer nada. Nao e
rem   derrubar processo - e nao subir um segundo. Duas instancias
rem   na mesma porta terminam com a segunda morrendo de
rem   EADDRINUSE dentro do log, onde ninguem ve.
rem
rem   Sem acentos de proposito: o Prompt do Windows usa outra
rem   tabela de caracteres e acento vira lixo na tela.
rem ============================================================
setlocal enabledelayedexpansion
title Iniciar a API - Farias Troca de Oleo
cd /d "%~dp0"

set "PASTA=%~dp0"
if "%PASTA:~-1%"=="\" set "PASTA=%PASTA:~0,-1%"

rem ---- a porta sai do .env; sem .env, vale o padrao do servidor.js ----
set "PORTA=3001"
if exist "%PASTA%\.env" (
  for /f "usebackq tokens=1,* delims==" %%a in ("%PASTA%\.env") do (
    if /i "%%a"=="PORT" set "PORTA=%%b"
  )
)
for /f "tokens=* delims= " %%p in ("!PORTA!") do set "PORTA=%%p"

echo.
echo   ============================================================
echo     FARIAS - subindo a API
echo     pasta: %PASTA%
echo     porta: !PORTA!
echo   ============================================================
echo.

rem ---- ja esta no ar? ----
echo   [1/2] conferindo se ja nao esta rodando
powershell -NoProfile -ExecutionPolicy Bypass -Command "try{ $r=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:!PORTA!/health' -TimeoutSec 3; if($r.StatusCode -eq 200){ exit 0 } else { exit 1 } }catch{ exit 1 }"
if errorlevel 1 goto SUBIR
echo.
echo   ============================================================
echo     A API JA ESTAVA NO AR na porta !PORTA!. Nao fiz nada.
echo     Se voce quer reinicia-la, use o REINICIAR.bat.
echo   ============================================================
echo.
echo   Esta janela fecha em 5 segundos.
timeout /t 5 /nobreak >nul
exit /b 0

:SUBIR
echo   [2/2] subindo
rem Primeiro pela tarefa agendada, que e como o INSTALAR.bat registrou
rem a API nesta maquina. Se ela nao existir, ou se faltar privilegio
rem para dispara-la (foi criada com /RL HIGHEST), cai no node direto -
rem que funciona sem administrador.
schtasks /Query /TN FariasAPI >nul 2>&1
if errorlevel 1 goto DIRETO
schtasks /Run /TN FariasAPI >nul 2>&1
if errorlevel 1 goto DIRETO
echo         pela tarefa agendada FariasAPI
goto CONFERE

:DIRETO
where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo   [X] o Node.js nao esta no PATH desta janela, entao nao da
  echo       para subir a API. Rode o INSTALAR.bat.
  goto FALHA
)
if not exist "%PASTA%\logs" mkdir "%PASTA%\logs"
start "FariasAPI" /min cmd /c node "%PASTA%\src\servidor.js" ^>^> "%PASTA%\logs\api.log" 2^>^&1
echo         direto pelo node, com a saida em logs\api.log

:CONFERE
rem "Mandei subir" nao e "subiu". O /health so devolve 200 depois de
rem fazer SELECT 1 no banco, entao esperar por ele prova as duas
rem coisas de uma vez: API de pe e banco respondendo.
echo.
echo   conferindo se respondeu
set /a TENTA=0
:PING
timeout /t 1 /nobreak >nul
set /a TENTA+=1
powershell -NoProfile -ExecutionPolicy Bypass -Command "try{ $r=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:!PORTA!/health' -TimeoutSec 3; if($r.StatusCode -eq 200){ exit 0 } else { exit 1 } }catch{ exit 1 }"
if not errorlevel 1 goto PRONTO
if !TENTA! GEQ 20 (
  echo.
  echo   [X] a API nao respondeu em 20 segundos.
  echo       o motivo costuma estar nas ultimas linhas de:
  echo           %PASTA%\logs\api.log
  goto FALHA
)
goto PING

:PRONTO
echo.
echo   ============================================================
echo     API NO AR - respondeu em http://127.0.0.1:!PORTA!/health
echo   ============================================================
echo.
echo   Esta janela fecha em 5 segundos.
timeout /t 5 /nobreak >nul
exit /b 0

:FALHA
echo.
echo   ============================================================
echo     A API NAO SUBIU. A janela fica aberta de proposito.
echo   ============================================================
echo.
pause
exit /b 1

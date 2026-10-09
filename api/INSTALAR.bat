@echo off
rem ============================================================
rem   Farias Troca de Oleo - instalacao automatica
rem
rem   Este arquivo e de proposito CURTO. Toda a logica de verdade
rem   esta em scripts\instalar.js, que e codigo Node e por isso da
rem   para testar antes de chegar aqui. Batch e a unica parte que
rem   nao tem como testar fora do Windows, entao aqui fica so o
rem   minimo: garantir que o Node existe e chamar o instalador.
rem
rem   Sem acentos neste arquivo de proposito: o Prompt do Windows
rem   usa outra tabela de caracteres e acento vira lixo na tela.
rem ============================================================
setlocal enabledelayedexpansion
title Instalador - Farias Troca de Oleo
cd /d "%~dp0"

echo.
echo   ============================================================
echo     FARIAS TROCA DE OLEO
echo     Instalacao do sistema
echo   ============================================================
echo.

rem ---- administrador: nao e obrigatorio, mas muda o que da para fazer ----
net session >nul 2>&1
if errorlevel 1 (
  echo   [!]  Voce NAO abriu como administrador.
  echo.
  echo        A instalacao funciona assim mesmo, mas sem administrador
  echo        nao da para instalar programa que falte nem registrar o
  echo        sistema para subir junto com o Windows.
  echo.
  echo        Recomendado: feche esta janela, clique com o botao
  echo        direito neste arquivo e escolha "Executar como
  echo        administrador".
  echo.
  choice /c SN /n /m "   Continuar mesmo assim? [S/N] "
  if errorlevel 2 exit /b 1
  echo.
)

rem ---- Node: e o unico pre-requisito do proprio instalador ----
where node >nul 2>&1
if not errorlevel 1 goto TEM_NODE

echo   [X]  O Node.js nao esta instalado. Sem ele nada roda.
echo.

where winget >nul 2>&1
if errorlevel 1 goto NODE_MANUAL

echo   Posso instalar agora pelo gerenciador de pacotes do Windows.
choice /c SN /n /m "   Instalar o Node.js agora? [S/N] "
if errorlevel 2 goto NODE_MANUAL

echo.
echo   Instalando o Node.js. Isso leva alguns minutos...
winget install --id OpenJS.NodeJS.LTS -e --silent --accept-source-agreements --accept-package-agreements
echo.

rem O winget nao atualiza o PATH desta janela que ja esta aberta, entao
rem procuro o node no lugar padrao antes de desistir.
where node >nul 2>&1
if not errorlevel 1 goto TEM_NODE
if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
where node >nul 2>&1
if not errorlevel 1 goto TEM_NODE

echo   [!]  O Node.js foi instalado, mas esta janela nao enxerga ele ainda.
echo        Feche esta janela e rode o INSTALAR.bat de novo.
echo.
pause
exit /b 1

:NODE_MANUAL
echo.
echo   Instale o Node.js voce mesmo:
echo     1. abra https://nodejs.org
echo     2. baixe a versao LTS
echo     3. instale com as opcoes padrao
echo     4. rode este INSTALAR.bat de novo
echo.
pause
exit /b 1

:TEM_NODE
for /f "tokens=*" %%v in ('node -v') do set "NODEV=%%v"
echo   [ok] Node.js !NODEV!
echo.

rem ---- daqui para frente, quem manda e o instalador em Node ----
node "%~dp0scripts\instalar.js" %*
set "CODIGO=%errorlevel%"

echo.
if not "!CODIGO!"=="0" (
  echo   ============================================================
  echo     A instalacao NAO foi concluida.
  echo.
  echo     Leia a mensagem acima: ela diz o que faltou E o que ja
  echo     ficou gravado nesta maquina. Rodar este arquivo de novo
  echo     e seguro - ele reconhece o que ja existe.
  echo   ============================================================
) else (
  echo   ============================================================
  echo     Instalacao concluida.
  echo   ============================================================
)
echo.
pause
exit /b !CODIGO!

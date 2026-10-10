@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
echo ============================================================
echo  Pediu Agente de Impressao - gerar o executavel (.exe)
echo ============================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERRO] O Node.js nao foi encontrado. Instale a versao LTS em https://nodejs.org e abra este arquivo de novo.
  pause & exit /b 1
)
for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODEMAJOR=%%v
if %NODEMAJOR% LSS 20 (
  echo [ERRO] Use o Node.js 20 ou mais novo. Versao atual: %NODEMAJOR%.
  pause & exit /b 1
)

echo [1/5] Instalando dependencias...
call npm install --no-audit --no-fund
if errorlevel 1 ( echo [ERRO] npm install falhou. & pause & exit /b 1 )

echo [2/5] Compilando o codigo do agente...
call node build.mjs --sea
if errorlevel 1 ( echo [ERRO] A compilacao falhou. & pause & exit /b 1 )

echo [3/5] Preparando o pacote do executavel...
> dist\sea-config.json echo {"main":"dist/agent.cjs","output":"dist/sea-prep.blob","disableExperimentalSEAWarning":true}
call node --experimental-sea-config dist\sea-config.json
if errorlevel 1 ( echo [ERRO] Nao foi possivel gerar o pacote. & pause & exit /b 1 )

echo [4/5] Criando o .exe a partir do Node.js...
for /f "delims=" %%p in ('node -p "process.execPath"') do set NODEEXE=%%p
copy /y "%NODEEXE%" dist\pediu-agente.exe >nul
if errorlevel 1 ( echo [ERRO] Nao foi possivel copiar o node.exe. & pause & exit /b 1 )
call npx --yes postject dist\pediu-agente.exe NODE_SEA_BLOB dist\sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
if errorlevel 1 ( echo [ERRO] Nao foi possivel injetar o agente no .exe. & pause & exit /b 1 )

echo [5/5] Colocando o icone da PediuLanchou...
if exist icone.ico (
  call npx --yes rcedit dist\pediu-agente.exe --set-icon icone.ico --set-version-string ProductName "Pediu Agente de Impressao" --set-version-string FileDescription "Pediu Agente de Impressao" --set-version-string CompanyName "PediuLanchou"
  if errorlevel 1 echo [AVISO] Nao foi possivel trocar o icone. O .exe funciona do mesmo jeito.
) else (
  echo [AVISO] icone.ico nao encontrado: o .exe fica com o icone padrao do Node.js.
)

echo.
echo ============================================================
echo  PRONTO: %~dp0dist\pediu-agente.exe
echo ============================================================
echo  Dois cliques no .exe abre a tela do agente no navegador.
echo  Ele ja inclui o Node.js: nao precisa instalar mais nada no computador da loja.
echo  Se o Windows avisar "protegeu o computador" (SmartScreen), e porque o arquivo nao e assinado: Mais informacoes ^> Executar assim mesmo.
echo.
pause

@echo off
REM Start T4WSProxy (.NET) in a new window
start "T4 WS Proxy" cmd /k "cd /d "%~dp0tools\dotNet\T4WSProxy" && dotnet run"

REM Start JSDemo (Node) in a new window
start "T4 JS Demo" cmd /k "cd /d "%~dp0tools\JavaScript\JSDemo" && npm start"

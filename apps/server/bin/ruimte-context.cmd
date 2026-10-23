@echo off
rem The same as `ruimte-context` beside it, for cmd and PowerShell in a checkout on Windows, which cannot run a shell script.
rem A build ships `ruimte-context.exe` instead (scripts/compile.ts), since cmd reads the words a batch file hands on a second time.
bun "%~dp0..\src\main.ts" context %*
exit /b %ERRORLEVEL%

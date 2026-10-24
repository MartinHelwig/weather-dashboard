@echo off
:: SPDX-FileCopyrightText: 2026 Martin Helwig
::
:: SPDX-License-Identifier: MIT
setlocal

pushd "%~dp0.."
deno test --allow-read --clean --coverage=build/tests/coverage --coverage-raw-data-only --junit-path=build/tests/junit-report.xml test/app.test.js
set "exit_code=%ERRORLEVEL%"
deno run --allow-read --allow-write=build/tests tools/coverage.js
if "%exit_code%"=="0" set "exit_code=%ERRORLEVEL%"
popd

exit /b %exit_code%

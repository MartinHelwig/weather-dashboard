@echo off
:: SPDX-FileCopyrightText: 2026 Martin Helwig
::
:: SPDX-License-Identifier: MIT
setlocal

pushd "%~dp0.."
deno run --allow-read test/app.test.js
set "exit_code=%ERRORLEVEL%"
popd

exit /b %exit_code%

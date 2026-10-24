#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Martin Helwig
#
# SPDX-License-Identifier: MIT

set -eu

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/.." && pwd)"

cd "$repo_root"
test_status=0
deno test --allow-read --clean --coverage=build/tests/coverage --coverage-raw-data-only --junit-path=build/tests/junit-report.xml test/app.test.js || test_status=$?

coverage_status=0
deno run --allow-read --allow-write=build/tests tools/coverage.js || coverage_status=$?

if ((test_status != 0)); then
	exit "$test_status"
fi
exit "$coverage_status"

#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Martin Helwig
#
# SPDX-License-Identifier: MIT

set -eu

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/.." && pwd)"

cd "$repo_root"
exec deno run --allow-read test/app.test.js

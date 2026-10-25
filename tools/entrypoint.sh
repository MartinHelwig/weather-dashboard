#!/bin/sh
# SPDX-FileCopyrightText: 2026 Martin Helwig
#
# SPDX-License-Identifier: MIT

set -e

cat << "EOF"
__      __        _   _              ___          _    _                      _ 
\ \    / /__ __ _| |_| |_  ___ _ _  |   \ __ _ __| |_ | |__  ___  __ _ _ _ __| |
 \ \/\/ / -_) _` |  _| ' \/ -_) '_| | |) / _` (_-< ' \| '_ \/ _ \/ _` | '_/ _` |
  \_/\_/\___\__,_|\__|_||_\___|_|   |___/\__,_/__/_||_|_.__/\___/\__,_|_| \__,_|
EOF

echo "Starting web server on port 8080..."
echo "--------------------------------------------------------"

exec httpd -f -v -p 8080 -h /home/www-data/www

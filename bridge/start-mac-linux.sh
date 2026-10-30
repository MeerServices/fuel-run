#!/bin/sh
cd "$(dirname "$0")"
command -v node >/dev/null 2>&1 || { echo "Node.js is niet gevonden. Installeer het via https://nodejs.org"; exit 1; }
exec node fuel-run-bridge.js "$@"

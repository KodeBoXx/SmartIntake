#!/usr/bin/env sh
set -eu
exec python3 tools/contracts/validate_schemas.py "$@"

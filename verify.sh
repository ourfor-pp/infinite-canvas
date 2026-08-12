#!/usr/bin/env bash
set -euo pipefail

npm --prefix web test
npm --prefix web run typecheck
npm --prefix web run build
npm --prefix server test
npm --prefix server run build

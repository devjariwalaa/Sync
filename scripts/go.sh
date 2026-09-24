#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
export GOPATH="$PWD/.tools/gopath" GOCACHE="$PWD/.tools/gocache"
if [ -x .tools/go/bin/go ]; then exec .tools/go/bin/go "$@"; else exec go "$@"; fi

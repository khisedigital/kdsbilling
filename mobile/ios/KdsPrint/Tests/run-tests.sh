#!/bin/sh
# Builds and runs the KdsPrint network sender tests on macOS (Foundation only, no device needed).
# Usage: ./run-tests.sh          (KDS_LOG=1 ./run-tests.sh to see TCP logs)
set -e
cd "$(dirname "$0")"
OUT="${TMPDIR:-/tmp}/kds-tcp-tests"
clang -fobjc-arc -Wall -Werror -framework Foundation -I.. \
  KdsTcpSenderTests.m ../KdsTcpSender.m ../KdsPrintError.m \
  -o "$OUT"
"$OUT"

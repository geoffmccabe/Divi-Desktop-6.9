#!/bin/sh
# Start the App Builder service.
#
#   sh contrib/app-builder/start.sh
#
# Leave it running in a terminal window and open App Builder in the wallet.
# Stop it with Ctrl-C. Your projects are on disk, so stopping loses nothing.
#
# Two keys are NOT set here on purpose. Both are handed over by the wallet:
#   * the Anthropic key, pasted into the App Builder panel
#   * the CoinMarketCap key, taken from the wallet's Value settings
# Neither is written to a file by this service.
set -e
cd "$(dirname "$0")"

# ⚠ OPENING CREDIT — 20,000 points is $20 of build time, given free to each
# account the first time it is seen. This is here so Geoff can test without
# buying first, and it is recorded in the ledger like any other movement so free
# points are never invisible when the books are read.
#
# TURN THIS OFF (delete the line) before this service is reachable by anyone
# else. As it stands every new account would be handed $20.
BUILDER_WELCOME_POINTS=${BUILDER_WELCOME_POINTS:-20000}
export BUILDER_WELCOME_POINTS

echo "App Builder service starting."
echo "Projects and points ledger live in your DD69 application-support folder."
echo "Opening credit for a new account: ${BUILDER_WELCOME_POINTS} points."
echo
exec node src/server.mjs

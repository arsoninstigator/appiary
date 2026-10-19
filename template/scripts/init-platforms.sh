#!/bin/sh
# bootstrap native platforms from the committed template. platform folders
# (ios/, android/) are deliberately not committed: each runner regenerates
# them per job, so the template stays small and capacitor upgrades painless.
# the injected capacitor.config.json already carries the user's appId, so
# generated platforms come out branded to their bundle id.
set -eu
cd "$(dirname "$0")/.."

platform="${1:?usage: init-platforms.sh <ios|android>}"

if [ "$platform" = "ios" ]; then
  [ -d ios ] || npx cap add ios
else
  [ -d android ] || npx cap add android
fi

npx cap sync "$platform"

#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Notarize & staple the macOS DMG
#
# Gereksinimler:
#   1) Keychain profil:  xcrun notarytool store-credentials "notarytool" \
#        --apple-id "YOU@APPLE.COM" --team-id "79DZ4AA4DW" --password "xxxx-xxxx-xxxx-xxxx"
#   2) release/Stealth Subtitle Translator-*.dmg (npm run electron:build ile uretilir)
#
# Kullanim:
#   bash scripts/notarize.sh [dmg-yolu]
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE="${NOTARY_PROFILE:-notarytool}"
TEAM_ID="${APPLE_TEAM_ID:-79DZ4AA4DW}"

DMG="${1:-}"
if [ -z "$DMG" ]; then
    DMG="$(ls -t "$ROOT_DIR"/release/*.dmg 2>/dev/null | head -1)"
fi
if [ -z "$DMG" ] || [ ! -f "$DMG" ]; then
    echo "DMG bulunamadi: $DMG" >&2
    echo "Once 'npm run electron:build' calistirin." >&2
    exit 1
fi

echo "=== Notarizing: $DMG ==="
xcrun notarytool submit "$DMG" --keychain-profile "$PROFILE" --team-id "$TEAM_ID" --wait

echo "=== Stapling ==="
xcrun stapler staple "$DMG"

echo "=== Verify ==="
spctl --assess --type open --verbose "$DMG" || true
echo "=== Done. DMG Gatekeeper-ready. ==="

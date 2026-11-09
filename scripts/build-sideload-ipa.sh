#!/usr/bin/env bash
# Builds an unsigned Release .ipa for sideloading with AltStore / SideStore
# (free Apple ID, no paid developer account required — the sideloading tool signs it).
#
# Usage:
#   npm run build:ios:sideload
#   BUNDLE_ID=com.example.bambuddy npm run build:ios:sideload   # custom bundle id
#   OUTPUT=~/Desktop/Bambuddy.ipa npm run build:ios:sideload    # custom output path
#
# Requirements: macOS with Xcode, Node.js, CocoaPods. See docs/SIDELOADING.md.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DERIVED="$ROOT/build/sideload"
OUTPUT="${OUTPUT:-$ROOT/dist/Bambuddy.ipa}"
LOG="$DERIVED/xcodebuild.log"

step() { printf '\n\033[1;32m==>\033[0m %s\n' "$*"; }
fail() { printf '\n\033[1;31mError:\033[0m %s\n' "$*" >&2; exit 1; }

command -v xcodebuild >/dev/null || fail "Xcode is not installed."
if ! xcodebuild -version >/dev/null 2>&1; then
  # Command Line Tools are selected instead of Xcode — use Xcode from /Applications.
  export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
  xcodebuild -version >/dev/null 2>&1 || fail "Xcode not found. Install it from the App Store and open it once."
fi
command -v pod >/dev/null || fail "CocoaPods is not installed (brew install cocoapods)."

cd "$ROOT"
if [ ! -d node_modules ]; then
  step "Installing JavaScript dependencies"
  npm install
fi

step "Installing CocoaPods dependencies"
(cd ios && LANG=en_US.UTF-8 pod install)

step "Building unsigned Release app (this takes a few minutes)"
mkdir -p "$DERIVED"
if ! xcodebuild \
  -workspace ios/Bambuddy.xcworkspace \
  -scheme Bambuddy \
  -configuration Release \
  -sdk iphoneos \
  -destination 'generic/platform=iOS' \
  -derivedDataPath "$DERIVED" \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" \
  build > "$LOG" 2>&1; then
  grep -E "error:" "$LOG" | head -20 >&2 || true
  fail "xcodebuild failed — full log: $LOG"
fi

APP="$DERIVED/Build/Products/Release-iphoneos/Bambuddy.app"
[ -d "$APP" ] || fail "Build finished but $APP is missing."

if [ -n "${BUNDLE_ID:-}" ]; then
  step "Setting bundle identifier to $BUNDLE_ID"
  /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $BUNDLE_ID" "$APP/Info.plist"
fi

step "Packaging .ipa"
STAGING="$(mktemp -d)"
trap 'rm -rf "$STAGING"' EXIT
mkdir -p "$STAGING/Payload" "$(dirname "$OUTPUT")"
cp -R "$APP" "$STAGING/Payload/"
rm -f "$OUTPUT"
(cd "$STAGING" && zip -qry "$OUTPUT" Payload)

VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Info.plist")"
IDENTIFIER="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Info.plist")"
step "Done: $OUTPUT"
echo "    version $VERSION · bundle id $IDENTIFIER · $(du -h "$OUTPUT" | cut -f1)"
echo "    Install it with AltStore: My Apps → + → choose the file (see docs/SIDELOADING.md)."

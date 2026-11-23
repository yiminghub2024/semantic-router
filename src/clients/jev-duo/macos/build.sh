#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
root="$PWD"
target="$(uname -m)"
case "$target" in
  arm64) node_arch=arm64 ;;
  x86_64) node_arch=x64 ;;
  *) echo "Unsupported architecture: $target" >&2; exit 1 ;;
esac
node_version=v24.22.3
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
app="$stage/Jev Duo.app"
contents="$app/Contents"
resources="$contents/Resources"
mkdir -p "$contents/MacOS" "$resources/desktop" dist
cp -R src "$resources/"
cp desktop/bridge.mjs "$resources/desktop/"
cp LICENSE package.json "$resources/"
curl -fsSL --retry 3 "https://nodejs.org/dist/$node_version/node-$node_version-darwin-$node_arch.tar.gz" -o "$stage/node.tgz"
expected="$(awk -v arch="$node_arch" '$2==arch { print $1 }' macos/node-checksums.txt)"
test -n "$expected"
echo "$expected  $stage/node.tgz" | shasum -a 256 -c -
tar -xzf "$stage/node.tgz" -C "$stage" "node-$node_version-darwin-$node_arch/bin/node" "node-$node_version-darwin-$node_arch/LICENSE"
cp "$stage/node-$node_version-darwin-$node_arch/bin/node" "$contents/MacOS/node"
cp "$stage/node-$node_version-darwin-$node_arch/LICENSE" "$resources/Node-LICENSE.txt"
xcrun swiftc -swift-version 5 -O -parse-as-library -target "$target-apple-macosx15.0" \
  macos/Services.swift macos/Settings.swift macos/JevDuo.swift -o "$contents/MacOS/JevDuo"
cp macos/Info.plist "$contents/"
codesign --force --sign - "$contents/MacOS/JevDuo"
codesign --force --sign - "$app"
codesign --verify --deep --strict "$app"
"$contents/MacOS/node" --input-type=module -e "import 'node:sqlite'"
archive="$root/dist/JevDuo-macOS-$node_arch.zip"
ditto -c -k --keepParent "$app" "$archive"
echo "$archive"

#!/bin/sh
# Builds home/site/cerebro-scene.js: Cerebro's own scene engine (its renderer,
# wandering, powers, 10 fps ticker and labels, ui/src/lib/scene in github.com/L00rdD/cerebro),
# bundled as is, so the home page's Cerebro cards draw the X-Mansion exactly as
# Cerebro does. Run it again when Cerebro's scenes change:
#   sh home/cerebro/build.sh [path to cerebro, default ../cerebro]
set -e
cd "$(dirname "$0")/../.."
src=$(cd "${1:-../cerebro}" && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
cat > "$tmp/entry.ts" <<TS
export { drawScene, CHARACTER_SCALE } from "$src/ui/src/lib/scene/renderer";
export { onFrame, setAnimating } from "$src/ui/src/lib/scene/ticker";
export { STATUS_LABELS, humanizeDuration } from "$src/ui/src/lib/format";
TS
"$src/node_modules/.bin/rolldown" "$tmp/entry.ts" --format iife --name CerebroScene \
  --file "$tmp/out.js" >/dev/null
{
  echo "// Cerebro's scene engine, built from $(git -C "$src" rev-parse --short HEAD) by home/cerebro/build.sh: do not edit."
  cat "$tmp/out.js"
} > home/site/cerebro-scene.js
echo "home/site/cerebro-scene.js: $(wc -c < home/site/cerebro-scene.js) bytes"

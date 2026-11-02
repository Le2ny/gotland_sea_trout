#!/usr/bin/env bash
# Publishes www/ to the gh-pages branch of the fork -> https://le2ny.github.io/gotland_sea_trout/
# Usage: source env.sh && tools/deploy_pages.sh
set -euo pipefail
cd "$(dirname "$0")/.."
node tools/build_web.mjs
SRC=$(git rev-parse --short HEAD)
TMP=$(mktemp -d)
cp -r www/. "$TMP/" && rm -f "$TMP/js/package.json" && touch "$TMP/.nojekyll"
cd "$TMP"
git init -q -b gh-pages && git add -A
git -c user.name="$(git -C "$OLDPWD" config user.name || echo Le2ny)" -c user.email="$(git -C "$OLDPWD" config user.email || echo le2ny@users.noreply.github.com)" \
  commit -qm "Deploy Gotland Sea Trout web app ($SRC)"
git push -q -f https://github.com/Le2ny/gotland_sea_trout.git gh-pages
rm -rf "$TMP"
echo "deployed $SRC -> https://le2ny.github.io/gotland_sea_trout/ (live after ~1 min)"

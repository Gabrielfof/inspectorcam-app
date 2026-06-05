#!/bin/bash
# Utilizare: ./scripts/release.sh 1.0.4

set -e

VERSION=$1

if [ -z "$VERSION" ]; then
  echo "Eroare: specificați versiunea. Exemplu: ./scripts/release.sh 1.0.4"
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PKG="$ROOT/itp-foto/server/package.json"

echo "→ Actualizez package.json la v$VERSION..."
node -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('$PKG', 'utf8'));
  pkg.version = '$VERSION';
  fs.writeFileSync('$PKG', JSON.stringify(pkg, null, 2) + '\n');
"

echo "→ Commit + push..."
cd "$ROOT"
git add itp-foto/server/package.json
git commit -m "chore: bump version to $VERSION"
git push

echo "→ Tag v$VERSION..."
git tag -d "v$VERSION" 2>/dev/null || true
git push origin ":refs/tags/v$VERSION" 2>/dev/null || true
git tag "v$VERSION"
git push origin "v$VERSION"

echo ""
echo "✓ Lansat v$VERSION! Build-ul rulează pe GitHub Actions (~8 min)."
echo "  https://github.com/Gabrielfof/inspectorcam-app/actions"

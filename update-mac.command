#!/bin/bash
# InspectorCam — Actualizare automata Mac
# Ruleaza o singura data. Dupa aceasta, actualizarile sunt complet automate.

echo ""
echo "========================================"
echo "  InspectorCam — Actualizare automata"
echo "========================================"
echo ""

# Detecteaza arhitectura CPU
ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ]; then
  echo "Placa: Apple Silicon (M1/M2/M3)"
  ASSET_FILTER="arm64-mac.zip"
else
  echo "Placa: Intel"
  ASSET_FILTER="-mac.zip"
fi

echo ""
echo "[1/5] Se opreste InspectorCam..."
pkill -x "InspectorCam" 2>/dev/null
sleep 2

echo "[2/5] Se cauta ultima versiune..."
API_RESPONSE=$(curl -s "https://api.github.com/repos/Gabrielfof/inspectorcam-app/releases/latest")

if [ "$ARCH" = "arm64" ]; then
  ZIP_URL=$(echo "$API_RESPONSE" | python3 -c "
import sys, json
data = json.load(sys.stdin)
assets = data.get('assets', [])
url = next((a['browser_download_url'] for a in assets if 'arm64-mac.zip' in a['name']), '')
print(url)
")
else
  ZIP_URL=$(echo "$API_RESPONSE" | python3 -c "
import sys, json
data = json.load(sys.stdin)
assets = data.get('assets', [])
url = next((a['browser_download_url'] for a in assets if a['name'].endswith('-mac.zip') and 'arm64' not in a['name']), '')
print(url)
")
fi

VERSION=$(echo "$API_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tag_name','?'))")

if [ -z "$ZIP_URL" ]; then
  echo ""
  echo "EROARE: Nu s-a gasit fisierul de actualizare."
  echo "Verificati conexiunea la internet si reincercati."
  read -p "Apasati Enter pentru a inchide..."
  exit 1
fi

echo "Versiune disponibila: $VERSION"
echo ""
echo "[3/5] Se descarca... (poate dura 1-2 minute)"
TMP_ZIP="/tmp/InspectorCam_update_$$.zip"
curl -L --fail --progress-bar -o "$TMP_ZIP" "$ZIP_URL"

if [ $? -ne 0 ] || [ ! -s "$TMP_ZIP" ]; then
  echo ""
  echo "EROARE: Descarcare esecuta."
  rm -f "$TMP_ZIP"
  read -p "Apasati Enter pentru a inchide..."
  exit 1
fi

echo ""
echo "[4/5] Se instaleaza..."
TMP_DIR=$(mktemp -d)
unzip -q "$TMP_ZIP" -d "$TMP_DIR" 2>/dev/null
NEW_APP=$(find "$TMP_DIR" -maxdepth 3 -name "*.app" | head -1)

if [ -z "$NEW_APP" ]; then
  echo "EROARE: Aplicatia nu a fost gasita in arhiva."
  rm -rf "$TMP_DIR" "$TMP_ZIP"
  read -p "Apasati Enter pentru a inchide..."
  exit 1
fi

# Determina locatia aplicatiei curente
TARGET=$(find /Applications ~/Applications -maxdepth 1 -name "InspectorCam.app" 2>/dev/null | head -1)
TARGET="${TARGET:-/Applications/InspectorCam.app}"

echo "Instalare in: $TARGET"
rm -rf "$TARGET"
cp -R "$NEW_APP" "$TARGET"

# Elimina restrictia Gatekeeper (esential pe Mac fara semnatura digitala)
xattr -rd com.apple.quarantine "$TARGET" 2>/dev/null || true

# Curata fisiere temporare
rm -rf "$TMP_DIR" "$TMP_ZIP"

echo ""
echo "[5/5] Se porneste InspectorCam $VERSION..."
sleep 1
open "$TARGET"

echo ""
echo "========================================"
echo "  Actualizare finalizata cu succes!"
echo "  De acum inainte actualizarile sunt"
echo "  complet automate - nu mai e nevoie"
echo "  sa rulezi acest script niciodata."
echo "========================================"
echo ""
read -p "Apasa Enter pentru a inchide aceasta fereastra..."

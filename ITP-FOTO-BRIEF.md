# ITP Foto — Brief de proiect pentru Claude Code

## Context business

Construiesc o aplicație pentru stațiile ITP din România care să respecte conform RNTR 1 obligația de fotografiere a vehiculelor la inspecția tehnică periodică. Concurența principală (SITP.ro, Servicegest.ro, ITPManager.ro) oferă platforme cloud complete.

**Diferențiatorul principal: soluție 100% locală, simplă, fără abonament cloud.**
- Datele rămân pe calculatorul clientului — argument GDPR puternic
- Funcționează fără internet — Wi-Fi local între telefon și PC
- Licență one-time posibilă — fără servere de întreținut
- Backup automat pe USB extern — protecție împotriva pierderii datelor

## Obiectiv MVP

În 1-2 săptămâni vreau să am o aplicație funcțională care:
1. Permite inspectorului să fotografieze mașinile cu telefonul (PWA)
2. Extrage automat numărul de înmatriculare via OCR
3. Aplică watermark permanent cu data, ora, nume inspector, denumire stație
4. Permite adăugarea de notițe text per fotografie (overlay permanent pe imagine)
5. Permite import fotografii din Camera Roll cu watermark aplicat automat
6. Trimite fotografiile la un server local rulând pe PC-ul Windows al stației
7. Creează automat foldere structurate `C:\ITP-Foto\2026\05\19\BV-88-ITP_15-42-33\`
8. Suportă 2-3 inspectori simultan
9. Funcționează offline cu sincronizare la reconectare
10. Backup automat zilnic pe USB extern conectat la PC

## Stack tehnic

### Componenta 1: PWA (interfața mobilă pentru inspectori)
- **HTML5 + Vanilla JavaScript** (fără framework greu — bundle mic, încărcare instant)
- **Tailwind CSS** via CDN
- **Tesseract.js** pentru OCR client-side pe numărul de înmatriculare
- **Canvas API** pentru watermark și overlay text notițe
- **IndexedDB** pentru storage offline
- **Service Worker** pentru offline-first
- **Web App Manifest** pentru instalare ca PWA

### Componenta 2: Server local Node.js (rulează pe PC-ul stației)
- **Node.js 20 LTS**
- **Express.js** pentru API REST
- **Multer** pentru upload fișiere
- **Sharp** pentru procesare imagini server-side (compresie, redimensionare)
- **SQLite** (better-sqlite3) pentru baza de date locală
- **Bonjour/mDNS** pentru discovery ca `itp-statie.local` în rețeaua locală
- **Electron** pentru împachetare în `.exe` cu system tray + UI configurare
- **chokidar** pentru monitorizare folder backup USB

### Distribuție
- **electron-builder** pentru installer `.exe`
- Installer adaugă automat:
  - Excepție în Windows Firewall
  - Pornire automată la boot
  - Icon în system tray

## Structura proiectului

```
itp-foto/
├── server/
│   ├── src/
│   │   ├── index.js
│   │   ├── routes/
│   │   │   ├── upload.js
│   │   │   ├── inspections.js
│   │   │   ├── config.js
│   │   │   └── inspectors.js
│   │   ├── lib/
│   │   │   ├── folderManager.js
│   │   │   ├── watermark.js
│   │   │   ├── database.js
│   │   │   ├── backup.js         # Backup automat USB
│   │   │   └── mdns.js
│   │   └── electron/
│   │       ├── main.js
│   │       ├── tray.js
│   │       └── settings-ui.html
│   ├── public/
│   ├── package.json
│   └── electron-builder.yml
│
├── pwa/
│   ├── index.html
│   ├── app.js
│   ├── camera.js                 # Captură foto + watermark + overlay notițe
│   ├── import.js                 # Import din Camera Roll
│   ├── ocr.js
│   ├── storage.js
│   ├── sync.js
│   ├── style.css
│   ├── manifest.json
│   ├── service-worker.js
│   └── icons/
│
└── README.md
```

## Funcționalități detaliate

### Pe partea de PWA (telefon inspector)

**Ecran 1: Login simplu**
- Selectare inspector dintr-o listă (configurată pe PC)
- PIN de 4 cifre (opțional)
- "Ține-mă conectat" — sesiune 8 ore

**Ecran 2: Lista inspecțiilor de azi**
- Buton mare "Inspecție nouă"
- Listă inspecții astăzi (număr înmatriculare, ora, status sync)
- Verde = sincronizat cu PC; galben = în așteptare

**Ecran 3: Flux fotografiere ghidat (pași obligatorii RNTR 1)**

1. **Foto 1: Față mașină cu plăcuța vizibilă**
   - După captură: OCR automat → extrage numărul → inspector confirmă sau corectează
2. **Foto 2: Vehicul pe standul de frânare**
3. **Foto 3: Compartiment motor cu capota ridicată** (doar clasa II — configurabil)
4. **Foto 4: Indicația odometrului**
5. **Foto 5: Amenajare interioară** (doar transport persoane >4 locuri — configurabil)
6. **Foto finală: După aplicarea ecusonului pe plăcuță**

Pentru fiecare pas:
- Instrucțiune clară + pictogramă
- Buton captură + buton refotografiere
- **Buton "Adaugă notiță"** — inspector poate scrie o observație scurtă (ex: "rugină prag stâng", "far crăpat") → textul apare ca overlay permanent pe fotografie, poziționat sus-centru, stil banner semitransparent, lizibil
- **Buton "Import din galerie"** — inspector selectează o fotografie existentă din Camera Roll; aplicația îi aplică watermark-ul complet (dată, oră, număr înmatriculare, inspector, stație) și o include în dosar ca și cum ar fi fost făcută din aplicație

**Watermark aplicat automat pe FIECARE fotografie (captură sau import):**
- Bottom-left: `2026-05-19 15:42:33`
- Bottom-right: numărul de înmatriculare (ex: `BV-88-ITP`)
- Top-left: numele stației
- Top-right: nume inspector
- Font alb cu contur negru, lizibil pe orice fundal
- **Permanent — parte din pixeli, imposibil de șters fără a strica imaginea**
- La import din Camera Roll: watermark include și mențiunea `[IMPORT]` pentru trasabilitate

**Overlay notițe text (opțional per fotografie):**
- Banner semitransparent negru, sus-centru pe imagine
- Text alb, font clar
- Aplicat pe Canvas înainte de salvare — permanent, parte din imagine
- Vizibil alături de watermark, nu îl suprascrie

**OCR pentru număr înmatriculare:**
- Rulează în background după Foto 1
- Tesseract.js cu whitelist: A-Z, 0-9, spațiu, liniuță
- Format românesc: `[AB] [12] [ABC]` sau `[B] [123] [ABC]`
- Input editabil — inspectorul confirmă sau corectează
- Dacă OCR eșuează: tastare manuală

**Ecran 4: Confirmare și trimitere**
- Thumbnails cu toate fotografiile (captură + importuri)
- Câmp număr înmatriculare (completat din OCR)
- Câmp opțional observații generale (text simplu, merge în metadata.json, nu pe poze)
- Buton "Trimite la calculator"
- Dacă offline: "Salvat local, trimis automat la reconectare"

**Ecran 5: Confirmare succes**
- Check verde
- "Inspecția salvată pe calculator"
- Calea folderului: `C:\ITP-Foto\2026\05\19\BV-88-ITP_15-42-33\`
- Butoane: "Inspecție nouă" / "Înapoi la listă"

### Pe partea de server (PC Windows)

**Endpoint-uri API:**
- `POST /api/inspections` — primește fotografii + metadate, creează folder, salvează
- `GET /api/inspections?date=2026-05-19` — listare inspecții
- `GET /api/inspections/:id` — detalii inspecție
- `GET /api/inspectors` — lista inspectori
- `POST /api/inspectors` — adăugare inspector
- `GET /api/config` — setări stație
- `POST /api/config` — actualizare setări

**Structura folderelor pe disk:**
```
C:\ITP-Foto\
  └── 2026\
      └── 05\
          └── 19\
              ├── BV-88-ITP_15-42-33\
              │   ├── 01-fata.jpg
              │   ├── 02-stand-franare.jpg
              │   ├── 03-motor.jpg
              │   ├── 04-odometru.jpg
              │   ├── 05-final.jpg
              │   └── metadata.json
              ├── B-145-XYZ_15-50-12\
              └── CJ-99-GTR_16-05-44\
```

**metadata.json:**
```json
{
  "id": "uuid",
  "plate": "BV 88 ITP",
  "datetime": "2026-05-19T15:42:33+03:00",
  "inspector": { "name": "Popescu Ion", "id": "insp-001" },
  "station": { "name": "Stația ITP Brașov Centru", "rar_code": "BV-001" },
  "photos": [
    {
      "step": "fata",
      "filename": "01-fata.jpg",
      "ocr_detected_plate": "BV 88 ITP",
      "timestamp": "2026-05-19T15:42:33Z",
      "note": "",
      "source": "camera"
    },
    {
      "step": "odometru",
      "filename": "04-odometru.jpg",
      "timestamp": "2026-05-19T15:45:10Z",
      "note": "Km: 187.432",
      "source": "import"
    }
  ],
  "notes": "Observații generale inspector",
  "device_id": "phone-inspector-1",
  "app_version": "1.0.0"
}
```

**Setări stație (Electron UI):**
- Nume stație, Cod RAR, Adresă
- Logo (pentru watermark)
- Folder de salvare (default `C:\ITP-Foto\` — configurabil, poate fi NAS sau alt drive)
- Lista inspectorilor (nume + PIN opțional)
- Activare/dezactivare etape opționale (clasa II, transport persoane)
- Folder backup USB (calea spre stick-ul USB)
- QR code DOAR pentru onboarding inspectori (scanează o dată cu telefonul ca să primească URL-ul PWA)

**System tray icon:**
- "Deschide dashboard"
- "Vezi folder ITP" (deschide Explorer)
- "Setări"
- "Despre"
- "Închide" (cu confirmare)
- Notificări Windows la inspecții noi

**Dashboard (fereastra Electron — pentru patron):**
- Status server (verde/roșu, port, IP local)
- QR code pentru onboarding inspectori
- Tabel inspecții azi (timp, inspector, număr, nr. foto)
- Filtrare după dată, inspector, număr înmatriculare
- Buton "Export raport zilnic PDF" — lista internă a patronului
- Status backup USB (ultima dată când s-a făcut backup, spațiu disponibil pe USB)

**Backup automat USB:**
- Rulează zilnic la o oră configurabilă (ex: 23:00)
- Copiază tot folderul `C:\ITP-Foto\` pe stick-ul USB configurat
- Structura identică pe USB cu structura de pe PC
- Notificare Windows dacă USB-ul nu e conectat când vine ora backup-ului
- Patronul vede în dashboard: "Ultimul backup: ieri 23:00 ✓" sau "⚠ USB deconectat"

## Cerințe non-funcționale

- **Performanță:** încărcare PWA <2s pe telefon; captură + watermark <1s
- **Securitate:** server ascultă DOAR pe rețeaua locală; PIN pentru inspectori
- **Robustețe:** retry automat la reconectare; IndexedDB păstrează fotografiile până sunt confirmate de server
- **Conformitate:** fotografii minim 1280x960px; JPEG quality 85%
- **Stocare:** ~30-50 ITP-uri/zi = ~5MB/zi = ~1.5GB/an, neglijabil
- **Confidențialitate:** fotografiile NU se trimit clienților finali. Arhivă internă + conformitate RAR exclusiv.
- **Integritate:** watermark-ul și overlay-urile notițelor sunt permanente, parte din pixeli — nu metadata separată

## Plan de implementare etapizat

**Faza 1 (zilele 1-2):** Server Node.js + Express, endpoint-uri bază, salvare foldere, SQLite, mDNS

**Faza 2 (zilele 3-4):** PWA — cameră, watermark Canvas, OCR Tesseract, upload la server

**Faza 3 (ziua 5):** Overlay notițe text per fotografie + Import din Camera Roll cu watermark

**Faza 4 (ziua 6):** Service Worker offline, IndexedDB, sync logic cu retry

**Faza 5 (zilele 7-8):** Electron wrapper, system tray, dashboard, settings UI

**Faza 6 (ziua 9):** Backup automat USB (chokidar + copiere nocturnă)

**Faza 7 (ziua 10):** electron-builder `.exe`, Windows Firewall, testing, polish UI

## Comenzi pentru a începe

```bash
mkdir itp-foto && cd itp-foto
mkdir server pwa
cd server
npm init -y
npm install express multer better-sqlite3 sharp bonjour-service uuid chokidar
npm install --save-dev electron electron-builder nodemon
```

## Instrucțiuni pentru Claude Code

Citește acest brief complet. Apoi:

1. Confirmă structura proiectului și ridică orice problemă tehnică înainte să începi
2. Construiește strict în ordinea fazelor — la fiecare fază oprește-te și arată ce ai făcut
3. Folosește best practices: ESM modules, async/await, error handling robust
4. Testează manual fiecare endpoint înainte să treci la pasul următor
5. Nu over-engineer — MVP funcțional, nu arhitectură enterprise
6. Pe Windows: folosește `path.join` pentru toate căile, niciodată hardcodat `/` sau `\`
7. Utilizatorul final NU este developer — mesajele de eroare trebuie să fie în română, clare, acționabile

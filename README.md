# MovieNebula
MovieNebula is an experimental data-visualization project that explores the cinematic universe as a dynamic network. It transforms movie metadata (e.g. genres, people, years, similarities) into an interactive, planet-like graph, allowing users to discover hidden connections between films through visual exploration.

## Projektstruktur (Download vs. Visualisierung)
- **Download der TMDB-Daten:** `scripts/download_tmdb.js`
- **Datenablage:** `data/movies.json`
- **Visualisierung (D3):** `web/index.html`, `web/app.js`, `web/styles.css`

## 1) TMDB-Daten als JSON herunterladen
> Voraussetzung: TMDB API-Key (v3) oder Access-Token (v4).

```bash
export TMDB_API_KEY="<dein_api_key>"
# oder: export TMDB_ACCESS_TOKEN="<dein_access_token>"
node scripts/download_tmdb.js --pages=1 --output=data/movies.json
```

- `--pages`: Anzahl der Discover-Seiten (je Seite ~20 Filme).
- `--output`: Zielpfad für die JSON-Datei.

Die JSON-Struktur enthält Filme mit **Genres**, **Keywords**, **Cast** und **Crew** (Regie). Beispiel siehe `data/movies.sample.json`.

## 2) Visualisierung starten
Für die Visualisierung reicht ein statischer Webserver:

```bash
python -m http.server 8000
```

Danach die Seite öffnen: `http://localhost:8000/web/`

Die Visualisierung lädt automatisch zuerst `data/movies.json`. Falls nicht vorhanden, wird `data/movies.sample.json` geladen.

### Alternative ohne Webserver (eingeschränkte Umgebung)
Du kannst `web/index.html` auch direkt per Doppelklick öffnen. In diesem Modus blockieren Browser oft das Laden von Dateien per `fetch`. Nutze dann den Datei-Upload **„JSON laden“**, um `data/movies.json` manuell auszuwählen.

## Hinweise
- Die TMDB-API hat Rate-Limits. Wenn du mehr Seiten lädst, kann es sinnvoll sein, im Download-Script einen kleinen Delay einzubauen.
- Die Visualisierung nutzt aktuell Genres, Keywords und Cast, lässt sich aber leicht um weitere Knoten erweitern (z.B. Produktionsfirmen, Länder, Sprachen).

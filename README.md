# CHRismi Chess — The Unbeatable Challenge

A responsive, single-player chess website made with **HTML, CSS, and JavaScript**. It is organized as one easy-to-upload folder, so you can push it to GitHub and deploy it with GitHub Pages or Vercel.

## Features

- Welcome screen and White/Black color selection.
- Legal move validation and game-state handling through `chess.js`.
- Board rotation when the player chooses Black.
- Click-to-select and click-to-move, legal move hints, last-move and check highlighting.
- Move history, check/checkmate/stalemate/draw handling.
- Attempts to load Stockfish in a Web Worker; the UI remains responsive while it calculates.
- If Stockfish cannot load, the game explicitly reports reduced-strength fallback mode. The fallback only selects from legal moves; it is **not** a strong chess engine.
- Generated move/capture/check/checkmate sounds using Web Audio API; optional browser speech announcement.
- Chrismi checkmate cinematic sequence: red king styling, spoken line, 60-second pause, then result popup.
- Rematch returns to color selection. Leave returns to the welcome screen.
- Responsive desktop/mobile layout and reduced-motion support.

## Run locally

1. Extract the ZIP or keep this folder as-is.
2. Open a terminal inside the `CHRismi-Chess` folder.
3. Start a local static server. If Python is installed:

   ```bash
   python -m http.server 8000
   ```

4. Open `http://localhost:8000` in your browser.

You can also open `index.html` directly, but using a local server is more reliable for browser workers.

## GitHub upload (terminal)

Create an empty repository on GitHub first. Do not add a README/license there if you already have this README locally.

```bash
cd path/to/CHRismi-Chess
git init
git add .
git commit -m "Initial CHRismi Chess project"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPOSITORY.git
git push -u origin main
```

Replace the URL with your repository URL. If Git says `remote origin already exists`, use:

```bash
git remote set-url origin https://github.com/YOUR-USERNAME/YOUR-REPOSITORY.git
git push -u origin main
```

## Deploy with Vercel

1. Push this folder to GitHub.
2. In Vercel, choose **Add New → Project** and import the repository.
3. Framework preset: **Other**.
4. Build command: leave blank.
5. Output directory: `.` (the repository root).
6. Deploy.

## Deploy with GitHub Pages

1. Open repository **Settings → Pages**.
2. Choose **Deploy from a branch**.
3. Select `main` and `/ (root)`, then save.

## Important engine note

The site uses CDN-hosted `chess.js` and tries to load the legacy browser-compatible Stockfish 10 JavaScript build in a worker. CDN availability, browser cross-origin policies, and worker compatibility vary. The app has a visible fallback instead of pretending Stockfish is running when initialization fails. Stockfish 10 is older and should not be described as the strongest current engine. For a final-year submission where maximum engine strength and dependable offline operation matter, vendor a tested modern Stockfish web build and its matching worker/WASM assets in `assets/`, then update `script.js` to load those local assets.

The 60-second checkmate pause is set in `script.js` at `60000` milliseconds. For local development only, you may temporarily change it to `5000`; restore `60000` before publishing.

## Limitations / verification

This is a static front-end project; it does not need a backend. I have generated the project files, but I have not run a real browser QA session or verified that the external CDNs are reachable from your network. Test the actual hosted version in the target browsers before presenting it as fully tested. The fallback mode is intentionally weaker than Stockfish and is labeled as such.

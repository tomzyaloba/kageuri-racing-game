# KAGEURI: NEON RUN

A browser-based arcade motorcycle racer built for the KAGEURI Web3/NFT project. Three.js for the 3D scene, hand-rolled arcade physics — no build step, no dependencies to install.

## Run it

Just open `index.html` in a browser. No server required for local testing (though some browsers restrict local file loading of the CDN script over `file://`; if you see a blank screen, run any static file server, e.g. `python3 -m http.server`, and open `http://localhost:8000`).

## Deploy on GitHub Pages

1. Push these three files (`index.html`, `style.css`, `script.js`) to a repo.
2. Repo Settings → Pages → set source to your default branch, root folder.
3. GitHub gives you a live URL in a minute or two.

## Controls

- **W/↑** accelerate, **S/↓** brake
- **A/D** or **←/→** steer
- **Shift** drift (charges nitro)
- **Space** nitro boost (once charged)
- Touch controls appear automatically on mobile.

## Files

- `index.html` — structure/DOM only
- `style.css` — all visual styling
- `script.js` — game logic (track, physics, AI, rendering)

## Credits

Designed & built by **@aloba_tomiwa**.

# Music studio

Requires Node.js 22.12 or newer and pnpm 10.

```sh
pnpm install
pnpm dev
```

For a production build:

```sh
pnpm build
pnpm preview
```

Vercel uses `vercel.json` to build with Vite and serve `dist`. Include the
`assets` folder, source files, `package.json`, and `pnpm-lock.yaml` in the
deployment. The model, JavaScript, decoder, and fonts are bundled locally;
Vite fingerprints their filenames for long-lived caching. No environment
variables or serverless functions are required.

The original `Music_studio.glb` is an authoring file and is intentionally
excluded from Git and Vercel uploads. Include its smaller web version,
`assets/music-studio.glb`, in your deployment; normal builds do not need the
original export.

To replace the model, put the new source at `Music_studio.glb`, preserving the
studio's world coordinates and named hotspot objects, then run:

```sh
pnpm optimize:model
pnpm build
pnpm test
```

The optimizer updates the GLB and `assets/studio.json` together. It removes
the old smoke cards, compresses textures and geometry, and records the smoke
sources at the lit objects on the desk. `smoke.js` renders animated wisps in
one draw call, with a smaller particle budget on mobile, reduced-motion
support, and no animation in hidden tabs.

Browser checks use installed Chrome. On CI, install Chromium with
`pnpm exec playwright install chromium`, set `PLAYWRIGHT_CHANNEL=chromium`,
and run `pnpm build` followed by `pnpm test`. Screenshots go to `.artifacts`.

Hotspots and overlay content are configured in `main.js`. The existing
BeatStars, video, gallery and contact content still contains placeholders.

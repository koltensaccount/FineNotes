# AGENTS.md — FineNotes Development Guide

## Project & Branch
- **Purpose**: FineNotes is an Obsidian plugin providing handwriting notebooks optimized for iPad and Apple Pencil (Goodnotes-inspired: real pages, templates, ink smoothing, shapes, PDF annotation/sync).
- **Working Repository**: Fork (`origin` at `https://github.com/koltensaccount/FineNotes`).
- **Integration Branch**: `integration/kolten` is the sole baseline. Never use upstream (`Joost-8/FineNotes`) `main` as a development baseline.

## Architecture Overview
- `src/view/`: Notebook views, toolbar, menus, selection overlay, modals, popovers.
- `src/canvas/`: Canvas rendering, tile grid, viewports, zoom, scrolling physics, PDF rasterization.
- `src/ink/`: Stroke construction, smoothing, line styles, eraser, shapes, geometry recognition.
- `src/input/`: Apple Pencil, touch, pointer events, palm rejection, multitouch gestures.
- `src/model/`: Notebook document model, commands, serialization/compression, history (undo/redo).
- `src/export/`: PDF composer, page ranges, annotation layers, and export infrastructure.
- `src/settings-data.ts`: Persistent plugin settings and defaults.
- `src/main.ts`: Obsidian plugin lifecycle, ribbon icons, commands, view registration.
- `styles.css`: Core plugin stylesheet.

## Critical Priorities
1. **Data Integrity**: Never corrupt notebook state or document storage.
2. **Pencil Latency & Feel**: Keep Pencil input path zero-overhead and responsive.
3. **Gesture Predictability**: Maintain palm rejection, smooth pinch-to-zoom, and scrolling.
4. **Undo/Redo**: Preserve strict correctness across all commands.
5. **PDF Quality & Live Sync**: Maintain companion PDF rasterization and sync fidelity.
6. **No Speculative Refactors**: Fix root causes; preserve working abstractions.

## Git Workflow & Safety
- **Branches**: Always branch off `integration/kolten` (`feature/*` or `fix/*`).
- **Sync**: GitHub is source of truth. Fetch latest `integration/kolten` before branching.
- **Safety**: Never force-push. Never merge into `integration/kolten` automatically. Never open upstream PRs. Never touch uncommitted files of other agents.
- **Commits**: Keep commits atomic and scoped only to files modified for the task.

## Testing & Verification
- **Code Validation**: Run targeted tests (`npm test` / Vitest) and production build (`npm run build`). Note: `npm run build` runs `tsc --noEmit && esbuild production`.
- **Obsidian Artifacts**: Production build outputs `main.js`, `manifest.json`, `styles.css`.
- **Physical Device**: iPad/Apple Pencil feel, drawing aesthetics, and gestures are verified by the user on hardware. Do not claim device verification without hardware tests.

## Release Restrictions
- Releases use BRAT prereleases via GitHub Actions triggered by version tags on `integration/kolten`.
- Never create release tags or publish unless explicitly requested.

## OpenAI Codex Delegation
- **Role**: Optional specialist for deep debugging, complex Apple Pencil gestures, shape math, PDF issues, or second-opinion diff reviews.
- **Auth**: Always use user's ChatGPT subscription (`codex exec`); never use API billing.
- **Policy**: Use sparingly. Always investigate first, craft a focused technical handoff, run in read-only sandbox (`--sandbox read-only`), and critically review output.

## Token Efficiency
- Inspect targeted files; search before opening large modules.
- Avoid repetitive status chatter, duplicate builds, or giant prompt payloads.

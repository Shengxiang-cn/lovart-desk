# Lovart Desk Project Memory

This document is the project-level handoff memory for future work on this repo.
Do not store secrets here.

## Project Purpose

Lovart Desk is a personal Lovart-style image workflow app:

- Left side: an infinite annotation canvas for image review and iteration.
- Right side: a built-in Agent chat panel for turning selected canvas context into better edit prompts.
- Core product loop: generate/edit images elsewhere, drag them into the canvas, mark them up, attach selected images or references to the Agent, then use the Agent response as the next edit instruction.

This project currently does not call an image-generation model directly. It is designed to preserve the user's ChatGPT membership image quota workflow while adding canvas selection, annotation, and structured prompt generation.

## Important URLs

- GitHub: https://github.com/Shengxiang-cn/lovart-desk
- Production: https://lovart-desk.vercel.app

## Current Architecture

- Framework: Next.js App Router.
- Main UI: `app/components/CreativeDesk.tsx`.
- Canvas engine: `@excalidraw/excalidraw`.
- Agent proxy route: `app/api/agent/route.ts`.
- Global styling: `app/globals.css`.
- Main page shell: `app/page.tsx`.

The app is intentionally small. Keep the main canvas workflow focused unless a heavier architecture is clearly needed.

## Implemented Capabilities

- Infinite canvas with Excalidraw.
- Drag image files onto the canvas.
- Persist scene locally in browser storage.
- Draw circles, arrows, freehand marks, and text annotations over images.
- Right-side Agent panel with Chat and API settings tabs.
- Select image elements on the canvas and attach them to the Agent context.
- Upload, paste, or drag images directly into the Agent composer.
- Send selected canvas images and uploaded references as OpenAI-compatible `image_url` message parts.
- Heavy mode can export the annotated canvas as a screenshot and include it in Agent context.
- Local fallback prompt generation still works when no API key is configured.

## Agent API

The server route `app/api/agent/route.ts` sends requests to an OpenAI-compatible chat-completions endpoint.

Default provider settings:

- `AGENT_BASE_URL=https://api.moonshot.cn/v1`
- `AGENT_MODEL=kimi-k2.5`
- `AGENT_API_KEY=` must be supplied locally or in Vercel environment variables.

Do not commit `.env.local` or any real API key.

Known Kimi 2.5 constraints:

- Use `temperature: 0.6`.
- Use `thinking: { "type": "enabled" }` for heavy mode.
- Use `thinking: { "type": "disabled" }` for fast mode.
- Higher/default temperatures caused production request failures before.

## Environment And Deployment

Local env file:

```text
.env.local
```

Example file:

```text
.env.local.example
```

Required Vercel production environment variables:

```text
AGENT_BASE_URL
AGENT_MODEL
AGENT_API_KEY
```

Vercel is connected to the GitHub repository. Pushing `main` should trigger deployment, but manual production deployment has also been used:

```bash
npx vercel --prod --yes
```

## Validation Commands

Run these before committing meaningful app changes:

```bash
npm run typecheck
npm run build
```

For UI changes, also verify the local app in browser:

```bash
npm run dev
```

Then open the active localhost port and check that the canvas, Agent panel, image upload, selection attachment, and heavy-mode path still work.

## Critical Gotchas

- Never print, commit, or document the real API key.
- `.env.local` is local-only and ignored by git.
- The app stores user scene data in browser localStorage, not in a backend database.
- Next.js devtools segment explorer previously caused local runtime/module errors. `next.config.ts` disables `experimental.devtoolSegmentExplorer`.
- `next.config.ts` ignores ESLint during builds. TypeScript and production build still need to pass.
- The right-side Agent must support visual context. A text-only chat box is not enough for this product.
- Clicking/selecting a canvas image should make that image available to the Agent composer.
- Uploaded composer images and selected canvas images are different sources and should stay distinguishable in the UI.

## Product Direction

The current app is a solid personal MVP, but it is not yet a full Lovart clone.

Useful next priorities:

- Add generated Agent actions that can create structured canvas todos, not only chat replies.
- Add image variant slots or version history per canvas image.
- Add explicit "send selected image to edit request" and "copy prompt to ChatGPT" commands.
- Add project/session management beyond browser localStorage.
- Add a stronger object model around images, annotations, comments, and iterations.
- Add real image generation/editing provider support only if API billing and quota tradeoffs are acceptable.

## Repo Operating Notes

- Keep changes small and workflow-oriented.
- Prefer extending `CreativeDesk.tsx` only until the component becomes clearly hard to maintain.
- If the Agent or canvas state grows further, split by responsibility:
  - canvas state and Excalidraw integration
  - attachment handling
  - Agent request building
  - right-panel UI
- Before pushing, check `git status -sb` and avoid committing local env files or generated folders.

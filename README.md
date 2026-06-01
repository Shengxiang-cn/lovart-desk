# Lovart Desk

Personal infinite-canvas image workbench for a ChatGPT-membership workflow.

The app does not call an image generation API directly. The intended loop is:

1. Generate or edit images in ChatGPT with your member quota.
2. Drag the resulting images into this canvas.
3. Circle, point, draw arrows, and add text notes on top of the image.
4. Use the side Agent panel to turn the canvas state into the next edit prompt.
5. Copy that prompt back to ChatGPT, or connect a third-party chat API in the API tab.

## Research Decision

I checked these open-source directions before implementing:

- `fancyboi999/Loomic`: closest to a Lovart-style product, Excalidraw-based with chat, Agent, Supabase, LangGraph, queues, image/video providers. It is too heavy for a personal membership-quota tool.
- `rms80/gsworkspace`: mature personal BYOK canvas with offline mode, image/video/text/prompt blocks, Claude/Gemini support, local server and IndexedDB. Good reference, but more complex than needed.
- `fal-ai-community/infinite-kanvas`: MIT, Next.js + React Konva, strong image canvas, drag/drop, IndexedDB, undo/redo, AI transformations. It is deeply coupled to fal.ai generation and transformation APIs.
- `excalidraw/excalidraw`: MIT, stable infinite canvas, image import, freehand drawing, circles, arrows, text, export, and embedding SDK.
- `tldraw/tldraw`: excellent SDK, but production usage has licensing/key considerations.
- `Flowscape-UI/canvas-react`: light Apache-2.0 canvas library, but it lacks built-in whiteboard annotation tools.

For this repo, the lowest-risk base is `@excalidraw/excalidraw`: it already solves the hard canvas interaction layer, while the custom code can focus on your workflow and the side Agent.

## Agent API

The API tab accepts an OpenAI-compatible chat endpoint:

- Base URL: `https://api.moonshot.cn/v1`
- Model: `kimi-k2.5`
- API Key: stored in local `.env.local`, or entered in the browser for this personal local app

Requests are sent through `app/api/agent/route.ts` to:

```text
{BASE_URL}/chat/completions
```

If no API is configured, the app still works: the side panel generates a local edit brief and copies it for ChatGPT.

## Development

```bash
npm install
npm run dev
```

If port 3000 is occupied, Next.js will pick another local port.

Validation commands:

```bash
npm run typecheck
npm run build
```

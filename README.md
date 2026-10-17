# CircuitForge

A beginner-friendly companion window for KiCad. Describe a circuit in plain English; an LLM turns the
words into a fixed list of steps, and the CircuitForge engine builds the schematic from circuit rules
and math, explaining every decision along the way.

```
npm install
npm run dev
```

## Backend + KiCad plugin

See [`kicad-ai-extension/README.md`](kicad-ai-extension/README.md) for full setup. The plugin needs KiCad 11 or a nightly.

```bash
cd kicad-ai-extension/backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 127.0.0.1 --port 8765 --reload
# then copy plugin/ to ~/Documents/KiCad/11.0/plugins/ai-schematic-generator and restart KiCad
```

| Method | URL | What it does |
| --- | --- | --- |
| GET | http://127.0.0.1:8765/api/health | Backend status |
| POST | http://127.0.0.1:8765/api/generate | Takes `{"prompt": "..."}` and returns the placeholder response |
| GET | http://127.0.0.1:8765/docs | Interactive API docs |
| GET | http://127.0.0.1:8765/openapi.json | Machine-readable API spec |

## Window layout

| Area | What it shows |
| --- | --- |
| Top-left: **Tutorial** | Chapter list; the tab on its edge opens the full-window tutorial (`src/components/tutorial/`): 01 an interactive, simulated circuit (press SW1, slow-motion C1 discharge, scope, part inspector, guided steps) · 02 a math lab (live LaTeX, 3 explanation levels, gauges, safety checks, bounce simulation, Kirchhoff) · 03 a KiCad build sequence driving a build-up schematic + Generate in KiCad · 04 ERC diagnostics with before/after diagrams. |
| Bottom-left | **Activity** feed, **Import / Export** (project JSON), **Settings** (KiCad version, connection). |
| Middle: **Thought process** | Your request and each step the engine took, with *why*. Click a step for an interactive lesson with LaTeX formulas (Ohm's law, pull-downs, RC debounce, nets as a graph, Kirchhoff's laws). Explanations come in three levels — like I'm 5 / beginner / expert — cycled with Shift+Tab in the chat box. |
| Right: **Checks** | ✓ / ✗ design checks; click one to jump to its step. |
| Colors | White UI; the schematic uses KiCad's default colors and can follow the user's KiCad theme via the bridge (`fetchKiCadColors`). |
| Top-right: **Preview design** | Schematic preview and parts list. |
| Bottom: **Chat** | Describe a circuit or ask for a change; the button on the right sends it. |

## Backend placeholders

All connections live in [`src/api/client.ts`](src/api/client.ts) and are **blank** (`ENDPOINTS.*` are
empty, `VITE_ENGINE_URL` / `VITE_KICAD_BRIDGE_URL` unset — see `.env.example`). Until they exist,
calls throw `NotConnectedError` and the UI says so. The window starts with a built-in example project
(`src/data/example.ts`); its checks and lesson numbers are computed by [`src/math.ts`](src/math.ts).

# CircuitForge

A beginner-friendly companion window for KiCad. Describe a circuit in plain English; the engine turns the
words into a fixed list of steps, builds the schematic from circuit rules and math, checks it with KiCad's
own ERC, and explains every decision along the way.

The engine is rule-based (no LLM, no API key needed): your sentence only chooses which knob to turn, and every
value comes from a formula you can read in the lessons. There is an optional model for big Arduino Uno project
descriptions, but it only picks parts and counts, and it's off unless you put a key in `backend/env/gemini.env`.

It builds 9 kinds of circuit: LED, voltage divider, RC filter, 555 blinker, regulator, push button, transistor
switch, Arduino Uno projects (joysticks, buttons, knobs, LEDs, buzzer) and an Arduino Nano with buttons and LEDs,
which also gets C++ firmware.

![The CircuitForge window](docs/circuitforge-window.png)

## Run it

KiCad 10 or newer must be installed (the service uses its command-line tools). Start the service first.

```bash
# 1. the service
cd kicad-ai-extension/backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 127.0.0.1 --port 8765 --reload
```

```bash
# 2. the web UI, from the repo root (the source is in frontend/)
npm install
npm run dev     # http://127.0.0.1:5173 (the port is fixed on purpose, see Security)
```

Or build it once and let the service serve it, which is how the app window works (see CircuitForge window below):

```bash
npm run build   # makes dist/, then open http://127.0.0.1:8765
```

`dist/` is not in git, so build it again after you pull.

Try: *"555 timer blinking a blue LED at 2 Hz on 9V"*, or *"red LED blinks when the button is pressed once, green LED
blinks if it's pressed twice within 0.5 s"* (that one makes a Nano and the code).

| UI | Service endpoint | What happens |
| --- | --- | --- |
| Prompt box | `POST /api/generate` | Rules pick the template; formulas set the values; KiCad's ERC fills in the checks |
| preview | `POST /api/desktop/preview` | KiCad draws the exact schematic |
| place in my schematic | `POST /api/desktop/place` | Copies the circuit so you can paste it into the schematic you have open |
| save / open pcb | `POST /api/desktop/save` | Saves a **new** project (never overwrites) and opens it |
| export | `POST /api/desktop/export` | Pictures (SVG, PDF, PNG), the code and the KiCad project in `~/Downloads/CircuitForge` |
| `kicad connected` | `GET /api/desktop/info` | Is KiCad installed here, and which project is open? |

If the service isn't running, the UI says so. The sample class (Classroom card, "sample class") works without it.

**Security.** The service has no login. It binds to `127.0.0.1`, answers only to `localhost` host names, and lets
only the app window (port 8765) and the dev server (port 5173) call it from a browser (set `ALLOWED_ORIGINS` in
`kicad-ai-extension/backend/.env` to use another port). It writes files and launches KiCad, so don't expose it
on a network.

## Backend + KiCad plugin

See [`kicad-ai-extension/README.md`](kicad-ai-extension/README.md) for full setup. On KiCad 10 the button only shows up in
the PCB Editor. On KiCad 11 or a nightly it's in the Schematic Editor too.

```bash
cd kicad-ai-extension/backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 127.0.0.1 --port 8765 --reload
# then copy plugin/ to ~/Documents/KiCad/10.0/plugins/ai-schematic-generator and restart KiCad
```

Health check: curl http://127.0.0.1:8765/api/health


Method	URL	What it does
GET	http://127.0.0.1:8765/api/health	Backend status
POST	http://127.0.0.1:8765/api/generate	Takes {"prompt": "..."} and returns the circuit, the KiCad files, the ERC result, and the code and lesson if there are any
GET	http://127.0.0.1:8765/docs	Interactive API docs
GET	http://127.0.0.1:8765/openapi.json	Machine-readable API spec
POST	http://127.0.0.1:8765/api/generate/save	Same as generate, but also saves it as a new KiCad project and opens it in the Schematic Editor


Request test:

curl -s -X POST http://127.0.0.1:8765/api/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt": "3.3V LDO from 5V with power LED"}' \
  | python3 -c "
import json, sys, pathlib
d = json.load(sys.stdin)
f = d['files']
out = pathlib.Path.home() / 'Documents' / 'KiCad' / 'ai_generated' / f['name']
out.mkdir(parents=True, exist_ok=True)
(out / (f['name'] + '.kicad_sch')).write_text(f['schematic'])
(out / (f['name'] + '.kicad_pro')).write_text(f['project'])
print('Saved to', out)
"

## CircuitForge window

`npm run build` in the repo root builds the UI (from `frontend/`); the backend serves it, and the KiCad toolbar button
opens it as its own app window. Describe a circuit, then place it in your schematic, save it, open the PCB, edit the
C++ (for microcontroller circuits), or export pictures + code.

**Classroom** (top left): a class about the circuit you just generated, built by the backend from that
circuit's own values (`kicad-ai-extension/backend/app/ai/lessons.py`): what it does, each part, its math
(LaTeX + "what if" sliders), the code, how to draw it in KiCad, how it was checked, and quizzes, at three
explanation depths. Each step's "explain" in the transcript opens the matching section.

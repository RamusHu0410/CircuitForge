# CircuitForge

A beginner-friendly companion window for KiCad. Describe a circuit in plain English; the engine turns the
words into a fixed list of steps, builds the schematic from circuit rules and math, checks it with KiCad's
own ERC, and explains every decision along the way.

The engine is rule-based today (no LLM, no API key): your sentence only chooses which knob to turn, and every
value comes from a formula you can read in the lessons. It builds one design family, a push button that lights
an LED on an Arduino Uno, and edits to it.

## Run it

Two terminals. KiCad 10 or newer must be installed (the service uses its command-line tools).

```bash
# 1. the service
cd kicad-ai-extension/backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 127.0.0.1 --port 8765 --reload
```

```bash
# 2. the web UI, from the repo root
npm install
npm run dev     # http://127.0.0.1:5173 (the port is fixed on purpose, see Security)
```

The **generate** button next to the prompt box is the general builder: type *"555 timer blinking a blue LED at 2 Hz on 9V"* and click it. (Enter, the arrow button, builds the Arduino lesson design instead.)

Try: *"When I press a button, a green LED should light up. Use an Arduino Uno."*, then
*"make the LED brighter"*, *"use a blue LED"*, *"remove the debounce"*.

| UI | Service endpoint | What happens |
| --- | --- | --- |
| **generate** button | `POST /api/generate`, `/api/generate/svg`, `/api/generate/save` | Builds any of 7 circuits (LED, divider, filter, 555 blinker, regulator, button, transistor), shows KiCad's drawing and ERC result, and opens it in KiCad |
| Prompt box | `POST /api/plan` | Rules pick the knobs; formulas set the values; KiCad's ERC fills in the checks |
| preview → schematic | `POST /api/design/svg` | KiCad draws the exact schematic, in your KiCad colors |
| open in kicad / Generate in KiCad | `POST /api/design/send` | Saves a **new** project in `~/Documents/KiCad/ai_generated/` (never overwrites) and opens it |
| `kicad connected` | `GET /api/kicad/status` | Is KiCad installed here? |
| Colors | `GET /api/kicad/colors` | Your KiCad schematic theme, if you use a custom one |

If the service isn't running, the UI says so and shows the start command. The bundled example keeps working.

**Security.** The service has no login. It binds to `127.0.0.1`, answers only to `localhost` host names, and lets
only `http://localhost:5173` and `http://127.0.0.1:5173` call it from a browser (set `ALLOWED_ORIGINS` in
`kicad-ai-extension/backend/.env` to use another port). It writes files and launches KiCad, so don't expose it
on a network.

## Backend + KiCad plugin

See [`kicad-ai-extension/README.md`](kicad-ai-extension/README.md) for full setup. The plugin needs KiCad 11 or a nightly.

```bash
cd kicad-ai-extension/backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 127.0.0.1 --port 8765 --reload
# then copy plugin/ to ~/Documents/KiCad/11.0/plugins/ai-schematic-generator and restart KiCad
```

Health check: curl http://127.0.0.1:8765/api/health


Method	URL	What it does
GET	http://127.0.0.1:8765/api/health	Backend status
POST	http://127.0.0.1:8765/api/generate	Takes {"prompt": "..."} and returns the placeholder response
GET	http://127.0.0.1:8765/docs	Interactive API docs
GET	http://127.0.0.1:8765/openapi.json	Machine-readable API spec
POST /api/generate/save. It generates the circuit, saves it as a new KiCad project, and opens it in the Schematic Editor.


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

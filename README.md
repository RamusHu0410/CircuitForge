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

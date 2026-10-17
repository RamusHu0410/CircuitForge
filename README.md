# CurcuitForge


How to run backend:

cd kicad-ai-extension/backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 127.0.0.1 --port 8765 --reload
# then copy plugin/ to ~/Documents/KiCad/11.0/plugins/ai-schematic-generator and restart KiCad


Method	URL	What it does
GET	http://127.0.0.1:8765/api/health	Backend status
POST	http://127.0.0.1:8765/api/generate	Takes {"prompt": "..."} and returns the placeholder response
GET	http://127.0.0.1:8765/docs	Interactive API docs
GET	http://127.0.0.1:8765/openapi.json	Machine-readable API spec
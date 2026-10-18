# backend (once)
cd ~/dev/CurcuitForge/kicad-ai-extension/backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# frontend (once)
cd ~/dev/CurcuitForge
npm install



cd ~/dev/CurcuitForge/kicad-ai-extension/backend
source .venv/bin/activate
uvicorn app.main:app --host 127.0.0.1 --port 8765 --reload

cd ~/dev/CurcuitForge
npm run dev

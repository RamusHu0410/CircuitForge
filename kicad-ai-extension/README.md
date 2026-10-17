# AI Schematic Generator for KiCad

Describe a circuit in plain language from inside the KiCad Schematic Editor.
The plugin sends the description to a local FastAPI backend. In later steps
the backend will turn it into a native `.kicad_sch` schematic and run ERC.

**Current status (Step 1):** the plugin, prompt dialog, and backend are wired
together. `POST /api/generate` returns a placeholder response. No schematic
is generated and no files are written.

## Supported KiCad versions

| KiCad | Supported | Why |
| ----- | --------- | --- |
| 11.0+ (and 10.99 nightlies) | Yes | IPC API plugins in the Schematic Editor were added in KiCad 11 |
| 9.x, 10.x | No | IPC plugins only appear in the PCB Editor there |

Source: [KiCad IPC API for add-on developers](https://dev-docs.kicad.org/en/apis-and-binding/ipc-api/for-addon-developers/).
At the time of writing, KiCad 11 has not had a stable release yet, so testing
needs a nightly build.

## Layout

```
plugin/            KiCad IPC plugin (this folder is what gets installed into KiCad)
  plugin.json        manifest: one action, scope "schematic"
  entrypoint.py      launched by KiCad; also `--check` for troubleshooting
  actions/           action logic (no UI)
  ui/                Tkinter prompt dialog
  kicad_client/      read-only connection to KiCad via kicad-python
  backend_client.py  stdlib HTTP client for the backend
  requirements.txt   installed by KiCad into the plugin's venv
backend/           FastAPI backend
tests/plugin/      plugin tests (kept outside plugin/ so they are not installed)
examples/          example circuits (later steps)
```

## 1. Start the backend

Requires Python 3.11+.

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 127.0.0.1 --port 8765 --reload
```

Check it: http://127.0.0.1:8765/api/health and http://127.0.0.1:8765/docs.

The backend binds to `127.0.0.1` only and has no authentication. Do not expose
it on a network interface.

## 2. Install the plugin in KiCad

1. **Install a Python with Tkinter.** KiCad 11 no longer bundles Python, and the dialog uses Tkinter.
   - macOS: the python.org installer includes Tkinter. With Homebrew, run `brew install python-tk@3.13` (match your Python version).
   - Linux: `sudo apt install python3-tk` (or your distro's equivalent).
   - Windows: the python.org installer includes Tkinter by default.

   Check it with `python3 -c "import tkinter"`.
2. **Configure KiCad.** In the Plugins preferences, enable the KiCad API and set the Python interpreter to the Python from step 1.
3. **Copy the plugin** into KiCad's IPC plugin directory, `<KiCad documents>/<version>/plugins/`. For example, on macOS with KiCad 11:

   ```bash
   mkdir -p ~/Documents/KiCad/11.0/plugins
   cp -R plugin ~/Documents/KiCad/11.0/plugins/ai-schematic-generator
   ```

   Default locations: macOS `~/Documents/KiCad`, Windows `C:\Users\<you>\Documents\KiCad`, Linux `~/.local/share/KiCad`.
   Nightlies use their own version folder (for example `10.99`).
4. **Restart KiCad and open the Schematic Editor.** The first time, KiCad creates a virtual environment and installs `kicad-python`. That takes a moment. When it finishes, the **AI Schematic Generator** button appears on the toolbar.
5. **Optional: change the backend URL.** By default the plugin uses `http://127.0.0.1:8765`. To change it, copy `config.example.json` to `config.json` in the installed plugin folder and edit it, or set `KICAD_AI_BACKEND_URL` in the environment KiCad is launched from.

## 3. Use it

Click **AI Schematic Generator**, describe a circuit, and press **Generate**
(or Ctrl/Cmd+Enter). The dialog shows progress, then either the backend's
response or a clear error, for example when the backend isn't running.
Esc or **Cancel** closes the dialog.

## Tests

```bash
# Backend
cd backend && source .venv/bin/activate && pytest

# Plugin (needs a Python with Tkinter; GUI tests are skipped without a display)
cd tests/plugin
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/pytest
```

The plugin tests cover:
- `plugin.json` against KiCad's official JSON schema and identifier rule.
- Backend client failures against a real local HTTP server: backend not running, timeout, 4xx/5xx, invalid JSON, wrong service on the port.
- The action logic.
- Settings.
- KiCad not running.
- A real Tk dialog: loading state, success, errors, cancel.

### Manual checks that need a running KiCad 11

These can't be automated without a KiCad instance:

1. The plugin loads with no load warning, and the button appears in the Schematic Editor toolbar. It must **not** appear in the PCB Editor.
2. Clicking the button opens the dialog in front of KiCad.
3. The dialog status line reads "Connected to KiCad <version>, project '<name>'".
4. With the backend running, Generate shows "Prompt received…". With it stopped, it shows "Backend not available…" and KiCad keeps working.
5. The open schematic is unchanged. This step never writes to it.

## Troubleshooting

- **No button appears.**
  - Check that you're running KiCad 11 or a nightly, and that the KiCad API is enabled.
  - Open the plugin preferences and look for load errors.
  - If the environment is broken, right-click the action there and choose **Recreate Plugin Environment**.
  - For a detailed trace, launch KiCad with `KICAD_ENABLE_WXTRACE=1 WXTRACE=KICAD_API`.
- **Clicking does nothing.**
  - Look at the warning messages in the editor's status bar; KiCad shows plugin stderr there.
  - The plugin also logs to `kicad-ai-schematic-generator.log` in the system temp folder (`python3 -c "import tempfile; print(tempfile.gettempdir())"`).
  - "Tkinter is not available" means KiCad's configured Python lacks Tk; see install step 1.
- **"Backend not available".** Start the backend (section 1). Also check that the port matches `config.json` or `KICAD_AI_BACKEND_URL`.
- **"…not the KiCad AI backend".** Another server is using that port. Change the port.
- **Debug outside KiCad.** Activate the plugin's environment, at `~/Library/Caches/KiCad/<version>/python-environments/com.curcuitforge.ai-schematic-generator` on macOS, then run:

  ```bash
  python ~/Documents/KiCad/11.0/plugins/ai-schematic-generator/entrypoint.py --check
  ```

  It prints the KiCad connection, backend health, and Tkinter status. Outside KiCad it reports "Not connected to KiCad", which is expected.

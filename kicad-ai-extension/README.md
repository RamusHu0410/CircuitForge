# AI Schematic Generator for KiCad

Describe a circuit in plain language from inside KiCad. The extension
generates a native KiCad schematic, checks it with KiCad's Electrical Rules
Check (ERC), and saves it as a new project next to yours. It never touches
your open design.

```
KiCad plugin (dialog) ──HTTP──▶ local backend ──▶ circuit spec ──▶ validator ──▶ .kicad_sch ──▶ kicad-cli ERC
```

## What it can generate

The interpreter is rule-based. It recognizes these circuits and calculates
values from the numbers in your prompt (voltages, currents, frequencies, LED
colors):

| Circuit | Example prompt |
| ------- | -------------- |
| LED indicator(s) | `3 green LEDs on 12V at 15mA` |
| Voltage divider | `voltage divider from 12V to 3.3V` |
| RC low-/high-pass filter | `low-pass filter at 1kHz` |
| 555 LED blinker | `555 timer blinking a blue LED at 2 Hz on 9V` |
| Linear regulator (7805 / AMS1117-3.3) | `3.3V LDO from 5V with power LED` |
| Push button with pull-up/down | `push button with pull-up on 3.3V and debounce` |
| NPN transistor LED switch | `transistor to switch a red LED from a 3.3V GPIO on 5V` |

For other prompts, it returns a clear "can't generate that yet" message that
lists what it supports. `GET /api/capabilities` returns the same list.

Every generated schematic uses official KiCad 10 library symbols with
footprints assigned. The drawing is a real, connected circuit:

- **Supply:** a battery symbol (`BT1`) stands for your power source.
- **Wires:** every connection is drawn as a wire, so you can follow the loop from the battery through the parts and back. Supply rails run along the top, ground along the bottom, and parts hang from or stand on them.
- **Power symbols:** `GND`/`+5V`/etc. appear only where an IC has power pins, along with `PWR_FLAG` so ERC knows the rail is supplied.
- **Labels:** nets with 3 or more pins get a name label (for example `DISCH`, `TIMING`). If a connection can't be wired without crossing another (for example the 555's CONT pin to its capacitor), it is joined by matching labels instead, which is electrically identical.

The test suite checks every circuit type with KiCad itself, for both the
planned layouts and the automatic layout used for circuits without layout hints:
ERC must report 0 violations, and KiCad's exported netlist must match the
intended connections exactly.

Preview the drawings yourself: `cd backend && python scripts/preview.py` renders
every sample, checks it with KiCad, and writes PNGs to `/tmp/kicad_preview`.

## Supported KiCad versions

| KiCad | Where the button appears |
| ----- | ------------------------ |
| 10.0.x (tested on 10.0.7) | **PCB Editor** toolbar. KiCad 9/10 only support IPC plugins there. |
| 11.0+ / 10.99 nightlies | PCB Editor and Schematic Editor |

## 1. Start the backend

Requires Python 3.11+.

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 127.0.0.1 --port 8765 --reload
```

Check it at http://127.0.0.1:8765/api/health (API docs: http://127.0.0.1:8765/docs).

ERC uses `kicad-cli`, which is found automatically on `PATH` or in the
standard KiCad install location. Set `KICAD_CLI_PATH` in `backend/.env` if
yours is elsewhere. Without it, schematics are still generated, and the
response says ERC was skipped.

The backend binds to `127.0.0.1` only and has no authentication. Don't expose
it on a network interface.

## 2. Install the plugin (KiCad 10, macOS)

1. **Quit KiCad.**
2. **Enable the KiCad API:** in KiCad, open **Preferences → Plugins** and check **Enable KiCad API**. KiCad 10's bundled Python works as the interpreter; the plugin fixes its Tkinter paths itself.
3. **Copy the plugin:**
   ```bash
   mkdir -p ~/Documents/KiCad/10.0/plugins
   cp -R plugin ~/Documents/KiCad/10.0/plugins/ai-schematic-generator
   ```
   Plugin folders on other systems: Windows `C:\Users\<you>\Documents\KiCad\10.0\plugins`, Linux `~/.local/share/KiCad/10.0/plugins`.
4. **Open a project's PCB Editor.** The first time, KiCad builds a Python environment for the plugin and installs `kicad-python`, which takes a few seconds. Then the **AI Schematic Generator** button appears on the toolbar.

To use a different backend URL, copy `config.example.json` to `config.json`
in the installed plugin folder and edit it, or set `KICAD_AI_BACKEND_URL`.

## 3. Use it

1. Click **AI Schematic Generator** in the PCB Editor toolbar.
2. Describe the circuit and press **Generate** (or Ctrl/Cmd+Enter).
3. The dialog shows the components, the calculated values with their formulas, and the ERC result.
4. Click **Open schematic** to open it in KiCad's Schematic Editor, or **Show in folder**.

Files are saved as a standalone KiCad project at
`<your project>/ai_generated/<name>/<name>.kicad_sch` (+ `.kicad_pro`). An
existing folder is never overwritten; the next one becomes `<name>_2`, and so
on. Without an open project, files go to `~/Documents/KiCad/ai_generated/`.

To use a generated circuit in your own design, open your schematic and add
the generated file as a hierarchical sheet, or copy and paste it in.

## Try it without the plugin (save and open from the API docs)

`POST /api/generate` only *returns* the schematic as text; it writes nothing.
To test from a browser or curl, use **`POST /api/generate/save`**. It
generates, saves a new project folder, and opens it in KiCad's Schematic Editor:

1. Open http://127.0.0.1:8765/docs, then **POST /api/generate/save → Try it out**.
2. Keep the example body (`{"prompt": "3.3V LDO from 5V with power LED", "open_in_kicad": true}`) or change the prompt, then **Execute**.
3. The response gives the exact `schematic_path`. KiCad opens it automatically; set `open_in_kicad` to `false` to only save.

Or with curl:

```bash
curl -s -X POST http://127.0.0.1:8765/api/generate/save \
  -H "Content-Type: application/json" \
  -d '{"prompt": "red LED on 5V at 10mA"}'
```

Files go to `~/Documents/KiCad/ai_generated/<name>/` by default (set `OUTPUT_DIR`
in `backend/.env` to change it). Existing folders are never overwritten; the
next one becomes `<name>_2`. This endpoint writes files and launches KiCad on the
machine running the backend, so keep the backend on `127.0.0.1`.

## Tests

```bash
# Backend: 144 tests. Includes real KiCad ERC + netlist checks when kicad-cli is installed.
cd backend && source .venv/bin/activate && pytest

# Plugin: 53 tests (needs a Python with Tkinter)
cd tests/plugin
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/pytest
```

## Layout

```
plugin/                      KiCad IPC plugin (copied into KiCad's plugins folder)
  plugin.json                  manifest: scopes "pcb" (KiCad 10) and "schematic" (KiCad 11)
  entrypoint.py                launched by KiCad; `--check` prints diagnostics
  actions/generate_schematic.py  prompt -> backend -> files on disk
  ui/prompt_dialog.py          Tkinter dialog
  kicad_client/                read-only KiCad IPC connection; opening results
  output_writer.py             safe, never-overwrite file writing
backend/app/
  ai/circuit_generator.py      prompt -> CircuitSpec (rule-based)
  core/component_registry.py   allowed parts -> KiCad symbols/footprints
  core/circuit_validator.py    resolves and checks every pin against the real symbol
  core/schematic_renderer.py   CircuitSpec -> .kicad_sch / .kicad_pro (placement, power symbols, labels)
  core/schematic_wiring.py     routes every net as wires; falls back to labels
  core/wire_router.py          orthogonal grid router (nets never touch)
  core/geometry.py             symbol rotation, mirror, extents, pin positions
  core/erc.py                  kicad-cli ERC
  templates/kicad_symbols.kicad_sym  vendored KiCad 10 symbols (regenerate: scripts/extract_symbols.py)
examples/kicad10_test_project/ test project used for KiCad 10 testing
```

## Troubleshooting

- **No button in the PCB Editor.**
  - Make sure the KiCad API is enabled and KiCad was restarted.
  - Check **Preferences → Plugins** for load errors. Right-click the action there and choose **Recreate Plugin Environment** if needed.
  - For a detailed trace, launch the PCB Editor with `KICAD_ENABLE_WXTRACE=1 WXTRACE=KICAD_API`.
- **Clicking does nothing.**
  - Look at the warning messages in the status bar.
  - The plugin logs to `kicad-ai-schematic-generator.log` in the system temp folder.
- **"Backend not available".** Start the backend (section 1).
- **"Can't generate that yet".** The prompt didn't match a supported circuit; see the table above.
- **ERC "not run".** The backend couldn't find `kicad-cli`; set `KICAD_CLI_PATH`.
- **Diagnostics:**
  ```bash
  ~/Library/Caches/KiCad/10.0/python-environments/com.curcuitforge.ai-schematic-generator/bin/python \
    ~/Documents/KiCad/10.0/plugins/ai-schematic-generator/entrypoint.py --check
  ```

# AI Schematic Generator for KiCad

Describe a circuit in plain language from inside KiCad. The extension
generates a native KiCad schematic, checks it with KiCad's Electrical Rules
Check (ERC), and saves it as a new project next to yours. It never touches
your open design.

```
KiCad button ──▶ CircuitForge window ──JS bridge──▶ engine (same process) ──▶ circuit spec ──▶ validator ──▶ .kicad_sch ──▶ kicad-cli ERC
```

Users install it from KiCad's **Plugin and Content Manager** and click the button. There is no server
to start: the plugin ships the engine (`backend/app`) and the built UI, and the window calls the engine
directly through pywebview's JavaScript bridge. The FastAPI backend is still there for development
(`npm run dev`, the browser, the API docs).

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

## 1. Install (users)

In KiCad: **Preferences → Plugins → Enable KiCad API**, then **Tools → Plugin and Content Manager**, find
**CircuitForge** and click **Install**. Open a project's PCB Editor; the first time, KiCad sets up the
plugin's Python environment (a few seconds). Then click the **AI Schematic Generator** button.

Before it's listed (or to test a build): **Plugin and Content Manager → Install from File...** and pick the
zip from `scripts/package_pcm.py` (see [Publish and update](#publish-and-update)).

## 2. Develop

Requires Python 3.11+ for the backend (the plugin itself needs 3.10+).

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cd ../.. && npm install && npm run build          # the UI the window shows (dist/)
python3 kicad-ai-extension/scripts/package_pcm.py --vendor-dev   # pywebview for the plugin (plugin/vendor/)
```

**Plugin in KiCad, straight from the repo:** enable the KiCad API (above), quit KiCad, and link the plugin
folder so code changes apply without copying:

```bash
mkdir -p ~/Documents/KiCad/10.0/plugins
ln -s "$PWD/kicad-ai-extension/plugin" ~/Documents/KiCad/10.0/plugins/ai-schematic-generator
```

Plugin folders on other systems: Windows `C:\Users\<you>\Documents\KiCad\10.0\plugins`, Linux
`~/.local/share/KiCad/10.0/plugins`. The linked plugin finds the engine in `backend/app` and the UI in
`dist/`. Rebuild the UI (`npm run build`) after frontend changes.

**Window without KiCad:** `cd backend && python -m app.desktop` (engine in-process, no server).

**Browser / hot reload:** `uvicorn app.main:app --host 127.0.0.1 --port 8765 --reload` in `backend/`, then
`npm run dev` in the repo root. API docs at http://127.0.0.1:8765/docs. To make the KiCad button use this
server instead of the built-in engine, put `{"backend_url": "http://127.0.0.1:8765"}` in the plugin's
`config.json` (or set `KICAD_AI_BACKEND_URL`).

ERC uses `kicad-cli`. The plugin passes the path of the KiCad that launched it; otherwise it's found on
`PATH` or in the standard install location. Set `KICAD_CLI_PATH` if yours is elsewhere. Without it,
schematics are still generated and the result says ERC was skipped.

The HTTP backend binds to `127.0.0.1` only and has no authentication. Don't expose it on a network interface.

## CircuitForge window

The toolbar button opens the **CircuitForge window**, a native app window (pywebview, using the system's
WebKit/WebView2). The plugin starts it as its own process (`python -m app.desktop --from-kicad`), so it
stays open after the click. pywebview shows the built UI and passes the page's calls straight to Python
(`backend/app/bridge.py`); the page loads `index.html#bridge`, which tells `frontend/api/client.ts` to use
the bridge instead of `fetch`.

- One window per user: it holds a lock in the CircuitForge state folder (`~/Library/Application Support/CircuitForge`,
  `%LOCALAPPDATA%\CircuitForge`, `~/.local/state/CircuitForge`). Each click writes the KiCad version and
  open project to `session.json` there; the open window comes forward and saves next to that project.
- **Place in my schematic** copies the circuit to the clipboard in KiCad's own format. In the Schematic
  Editor press Cmd/Ctrl+V and click to drop it. Nothing writes to your files.
- **Save as a new project** writes `<your project>/ai_generated/<name>/` and opens it.
- **Preview** is KiCad's own SVG rendering (`kicad-cli sch export svg`).
- To keep the old Tkinter dialog, set `"interface": "dialog"` in the plugin's `config.json`. The dialog is
  also the fallback when the window can't open (for example on Linux without GTK/Qt bindings); it runs the
  engine in the plugin too.

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
# Backend: includes real KiCad ERC + netlist checks when kicad-cli is installed.
cd backend && source .venv/bin/activate && pytest

# Plugin (needs a Python with Tkinter; run --vendor-dev first, see "Develop")
cd tests/plugin
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/pytest
```

## Layout

```
plugin/                      KiCad IPC plugin (becomes plugins/ in the PCM package)
  plugin.json                  manifest: scopes "pcb" (KiCad 10) and "schematic" (KiCad 11)
  entrypoint.py                launched by KiCad; `--check` prints diagnostics
  engine.py                    finds the engine + UI, opens the window, runs the engine for the dialog
  requirements.txt             installed by KiCad (wheels only); pywebview itself is bundled in vendor/
  actions/generate_schematic.py  prompt -> engine -> files on disk (the dialog)
  ui/prompt_dialog.py          Tkinter dialog
  kicad_client/                read-only KiCad IPC connection; opening results
  output_writer.py             safe, never-overwrite file writing
pcm/metadata.json            Plugin and Content Manager metadata; the version history lives here
pcm/icon.png                 64x64 package icon
scripts/package_pcm.py       builds the PCM zip + the metadata for KiCad's addons repo
backend/app/
  desktop.py                   the CircuitForge window (engine in-process, or UI from a server with --url)
  bridge.py                    what the page can call through pywebview (no HTTP)
  actions.py                   preview / save / place / export, shared by the bridge and the HTTP routes
  instance.py                  one window per user; KiCad clicks hand over the open project
  main.py, api/                FastAPI app for development (not shipped in the plugin)
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
  - The plugin logs to `kicad-ai-schematic-generator.log` in the system temp folder; the window logs to
    `window.log` in the CircuitForge state folder.
- **The dialog opens instead of the window.** The window couldn't start; the reason is in the plugin log
  and `window.log`. On Linux, pywebview needs GTK or Qt bindings in the plugin's Python environment.
- **"Can't generate that yet".** The prompt didn't match a supported circuit; see the table above.
- **ERC "not run".** The backend couldn't find `kicad-cli`; set `KICAD_CLI_PATH`.
- **Diagnostics:**
  ```bash
  ~/Library/Caches/KiCad/10.0/python-environments/com.curcuitforge.ai-schematic-generator/bin/python \
    ~/Documents/KiCad/10.0/plugins/ai-schematic-generator/entrypoint.py --check
  ```

## Publish and update

KiCad's Plugin and Content Manager lists packages from
[gitlab.com/kicad/addons/metadata](https://gitlab.com/kicad/addons/metadata). Each release is a zip you
host (a GitHub release asset works) plus an entry in that repo.

**First release**

1. Fill in `author.name` and `license` in `pcm/metadata.json`. The identifier
   (`com.curcuitforge.ai-schematic-generator`, same as `plugin/plugin.json`) can't change after release.
2. `python3 kicad-ai-extension/scripts/package_pcm.py` builds the UI, bundles pywebview and writes
   `build/pcm/<identifier>-<version>.zip` and `build/pcm/metadata.json`.
3. Test it: **Plugin and Content Manager → Install from File...** (remove the symlinked dev copy first).
4. Commit `pcm/metadata.json` (the script recorded the zip's URL, sha256 and sizes) and tag `v<version>`.
   Create a GitHub release for the tag and upload the zip; its URL must match `download_url`.
5. Fork the addons repo, add `packages/<identifier>/metadata.json` (copy of `build/pcm/metadata.json`) and
   `packages/<identifier>/icon.png`, and open a merge request. KiCad maintainers review it; once merged it
   shows up for everyone.

**Updates**

1. Add a new entry at the end of `"versions"` in `pcm/metadata.json` with a higher `version`
   (keep the old entries).
2. Run the script, test the zip, commit, tag, and upload the zip to a new GitHub release.
3. Open a merge request replacing `packages/<identifier>/metadata.json` with the new `build/pcm/metadata.json`.
   Once merged, users see **Update** in the Plugin and Content Manager.

Never re-upload a different zip under a released version: the sha256 in the addons repo would no longer
match and KiCad refuses to install it. Bump the version instead.

## Microcontroller projects (complex prompts)

Prompts that mention joysticks, buttons, knobs, LEDs, a buzzer or a game (for example "two-player football game
with two joysticks and LEDs for game state and scoring") are built around an Arduino Uno:

1. The prompt becomes a `SystemPlan` (modules and counts) by rules (`app/ai/system_rules.py`) or, optionally, by a
   language model (`app/ai/llm_planner.py`; set `LLM_API_KEY` and `LLM_MODEL`; the prompt is sent to that service).
2. `app/ai/system_designer.py` assigns Uno pins, sizes LED resistors and moves LEDs onto 74HC595 shift registers
   when pins run out. The model never picks pins, nets or values.
3. Blocks are drawn separately and joined by net labels and power symbols; validation and KiCad ERC run as usual.

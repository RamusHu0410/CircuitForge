import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Footprints, Hand, MousePointerClick, RotateCcw, Sparkles, X, Zap } from "lucide-react";
import type { Level } from "../../types";
import { kindInfo, netInfo, TINY } from "../../lab/knowledge";
import { cleanPinName, type Layout, type Netlist } from "../../lab/scene";
import { defaultInput, type SimControls, type SimResult } from "../../lab/sim";
import { LED_RGB, LED_VF, type LedColor, ledColor, parseValue, si, volts } from "../../lab/values";
import { Inside } from "./Inside";
import type { Selection } from "./types";

interface Props {
  selection: Selection | null;
  onSelect: (s: Selection | null) => void;
  netlist: Netlist;
  layout: Layout;
  result: SimResult | null;
  controls: SimControls;
  update: (fn: (c: SimControls) => SimControls) => void;
  level: Level;
  summary?: string;
  onTour: () => void;
}

/** "4700" → "4.7k", 1e-7 → "100n": how the engine writes values. */
function shortValue(x: number): string {
  for (const [f, p] of [
    [1e6, "M"],
    [1e3, "k"],
    [1, ""],
    [1e-3, "m"],
    [1e-6, "u"],
    [1e-9, "n"],
    [1e-12, "p"],
  ] as const) {
    if (Math.abs(x) >= f * 0.9995) return `${parseFloat((x / f).toPrecision(3))}${p}`;
  }
  return String(x);
}

/** A slider over a log range, snapped to E12 values. */
function LogSlider({ value, min, max, unit, onChange }: { value: number; min: number; max: number; unit: string; onChange: (v: number) => void }) {
  const E12 = [1, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2];
  const pos = Math.log10(value / min) / Math.log10(max / min);
  return (
    <label className="ctl">
      <input
        type="range"
        min={0}
        max={1000}
        value={Math.round(pos * 1000)}
        onChange={(e) => {
          const raw = min * (max / min) ** (Number(e.target.value) / 1000);
          const dec = 10 ** Math.floor(Math.log10(raw));
          const snapped = E12.map((m) => m * dec).reduce((a, b) => (Math.abs(Math.log(b / raw)) < Math.abs(Math.log(a / raw)) ? b : a));
          onChange(snapped);
        }}
      />
      <b>{si(value, unit)}</b>
    </label>
  );
}

/** The last few seconds of a value, as a tiny graph. */
function useHistory(key: string, value: number | undefined, t: number | undefined) {
  const buf = useRef<{ key: string; pts: [number, number][] }>({ key, pts: [] });
  if (buf.current.key !== key) buf.current = { key, pts: [] };
  if (value !== undefined && t !== undefined) {
    const pts = buf.current.pts;
    if (!pts.length || pts[pts.length - 1][0] !== t) pts.push([t, value]);
    while (pts.length > 140) pts.shift();
  }
  return buf.current.pts;
}

function Spark({ pts, unit }: { pts: [number, number][]; unit: string }) {
  if (pts.length < 3) return null;
  const ts = pts.map((p) => p[0]);
  const vs = pts.map((p) => p[1]);
  const t0 = Math.min(...ts);
  const t1 = Math.max(...ts) || 1;
  const lo = Math.min(0, ...vs);
  const hi = Math.max(...vs, lo + 0.01);
  if (hi - lo < 0.02 && pts.length > 10) return null; // flat: nothing to see
  const x = (t: number) => ((t - t0) / (t1 - t0 || 1)) * 236 + 2;
  const y = (v: number) => 46 - ((v - lo) / (hi - lo)) * 42;
  return (
    <figure className="spark">
      <svg viewBox="0 0 240 50" preserveAspectRatio="none">
        <polyline points={pts.map((p) => `${x(p[0])},${y(p[1])}`).join(" ")} />
      </svg>
      <figcaption>
        {si(lo, unit)} – {si(hi, unit)} over the last {si(t1 - t0, "s")} of circuit time
      </figcaption>
    </figure>
  );
}

function Story({ kind, value, reading, pinV }: { kind: string; value: string; reading: SimResult["parts"][string] | undefined; pinV: Record<string, number> }) {
  const story = kindInfo(kind).story;
  const [step, setStep] = useState(0);
  useEffect(() => setStep(0), [kind]);
  if (!story.length) return null;
  const s = story[Math.min(step, story.length - 1)];
  return (
    <section className="insp-sec story">
      <h4>
        <Sparkles size={13} /> How it works
      </h4>
      <Inside kind={kind} value={value} reading={reading} pinV={pinV} step={step} />
      <div className="story-step">
        <b>
          {step + 1}. {s.title}
        </b>
        <p>{s.text}</p>
      </div>
      <div className="story-nav">
        <button className="icon-btn" disabled={step === 0} onClick={() => setStep(step - 1)} aria-label="Previous step">
          <ArrowLeft size={14} />
        </button>
        {story.map((_, i) => (
          <button key={i} className={`story-dot${i === step ? " on" : ""}`} onClick={() => setStep(i)} aria-label={`Step ${i + 1}`} />
        ))}
        <button className="icon-btn" disabled={step === story.length - 1} onClick={() => setStep(step + 1)} aria-label="Next step">
          <ArrowRight size={14} />
        </button>
      </div>
    </section>
  );
}

function PartControls({ part, controls, update, result }: { part: Netlist["parts"][number]; controls: SimControls; update: Props["update"]; result: SimResult | null }) {
  const ref = part.ref;
  const value = controls.overrides[ref] ?? part.value;
  const setValue = (v: string | null) =>
    update((c) => {
      const overrides = { ...c.overrides };
      if (v === null) delete overrides[ref];
      else overrides[ref] = v;
      return { ...c, overrides };
    });
  const changed = ref in controls.overrides;
  const reset = changed && (
    <button className="link small" onClick={() => setValue(null)}>
      <RotateCcw size={11} /> back to {part.value}
    </button>
  );
  switch (part.kind) {
    case "push_button": {
      const press = (down: boolean) => update((c) => ({ ...c, pressed: { ...c.pressed, [ref]: down } }));
      return (
        <section className="insp-sec ctl-sec">
          <button className={`btn hold${controls.pressed[ref] ? " on" : ""}`} onPointerDown={() => press(true)} onPointerUp={() => press(false)} onPointerLeave={() => controls.pressed[ref] && press(false)}>
            <Hand size={14} /> {controls.pressed[ref] ? "pressed" : "hold to press"}
          </button>
          <span className="dim small">or click and hold it in the 2D/3D view</span>
        </section>
      );
    }
    case "potentiometer":
      return (
        <section className="insp-sec ctl-sec">
          <label className="ctl">
            <span>knob</span>
            <input type="range" min={0} max={100} value={Math.round((controls.wiper[ref] ?? 0.5) * 100)} onChange={(e) => update((c) => ({ ...c, wiper: { ...c.wiper, [ref]: Number(e.target.value) / 100 } }))} />
            <b>{Math.round((controls.wiper[ref] ?? 0.5) * 100)}%</b>
          </label>
        </section>
      );
    case "resistor":
    case "capacitor":
    case "capacitor_polarized": {
      const isR = part.kind === "resistor";
      const v = parseValue(value) ?? (isR ? 1000 : 1e-7);
      return (
        <section className="insp-sec ctl-sec">
          <span className="ctl-title">What if it were…</span>
          <LogSlider value={v} min={isR ? 10 : 1e-9} max={isR ? 1e6 : 1e-3} unit={isR ? "Ω" : "F"} onChange={(x) => setValue(shortValue(x))} />
          {reset}
        </section>
      );
    }
    case "battery": {
      const v = parseValue(value) ?? 9;
      return (
        <section className="insp-sec ctl-sec">
          <label className="ctl">
            <span>voltage</span>
            <input type="range" min={1} max={24} step={0.5} value={v} onChange={(e) => setValue(`${e.target.value}V`)} />
            <b>{v} V</b>
          </label>
          {reset}
        </section>
      );
    }
    case "led":
      return (
        <section className="insp-sec ctl-sec">
          <span className="ctl-title">Colour (a different material)</span>
          <div className="led-colors">
            {(Object.keys(LED_VF) as LedColor[]).map((c) => (
              <button key={c} className={`led-chip${ledColor(value) === c ? " on" : ""}`} style={{ background: LED_RGB[c] }} title={`${c}: about ${LED_VF[c]} V`} aria-label={c} onClick={() => setValue(`LED_${c[0].toUpperCase()}${c.slice(1)}`)} />
            ))}
          </div>
          {reset}
        </section>
      );
    case "connector_2pin":
    case "connector_3pin": {
      if (!/in|control|ctrl|signal/i.test(part.value) || /out/i.test(part.value)) return null;
      const src = controls.inputs[ref] ?? defaultInput(part);
      const set = (patch: Partial<typeof src>) => update((c) => ({ ...c, inputs: { ...c.inputs, [ref]: { ...src, ...patch } } }));
      return (
        <section className="insp-sec ctl-sec">
          <span className="ctl-title">What goes into {ref}</span>
          <div className="seg-row">
            {(["dc", "square", "sine"] as const).map((m) => (
              <button key={m} className={`seg${src.mode === m ? " on" : ""}`} onClick={() => set({ mode: m })}>
                {m === "dc" ? "steady" : m}
              </button>
            ))}
          </div>
          <label className="ctl">
            <span>level</span>
            <input type="range" min={0} max={12} step={0.1} value={src.level} onChange={(e) => set({ level: Number(e.target.value) })} />
            <b>{src.level.toFixed(1)} V</b>
          </label>
          {src.mode !== "dc" && <LogSlider value={src.freq} min={0.5} max={20000} unit="Hz" onChange={(f) => set({ freq: f })} />}
        </section>
      );
    }
    case "arduino_uno":
    case "arduino_nano":
    case "shift_register_74hc595": {
      const modes = result?.pinModes[ref] ?? {};
      const pins = Object.entries(modes).filter(([num]) => part.pins[num]);
      const program = result?.mcu?.[ref] ?? (part.kind === "shift_register_74hc595" ? Object.values(result?.mcu ?? {})[0] : undefined);
      const running = !!program?.running;
      if (!pins.length && !program) return null;
      return (
        <section className="insp-sec ctl-sec">
          {program?.error ? (
            <div className="prog-state bad">Your program stopped: {program.error}</div>
          ) : running ? (
            <div className="prog-state ok">{part.kind === "shift_register_74hc595" ? "Driven by the program on the Arduino." : "Your program is running: it sets these pins, the circuit answers."}</div>
          ) : (
            <span className="ctl-title">Pins in use (no program: switch the outputs yourself)</span>
          )}
          <div className="gpio">
            {pins.map(([num, mode]) => {
              const name = cleanPinName(part.pinNames[num] ?? num);
              const v = result?.netV[part.pins[num]] ?? 0;
              if (mode === "output" && running) {
                return (
                  <span key={num} className={`gpio-pin out${v > 2.5 ? " on" : ""}`} title={`${name} → ${part.pins[num]}`}>
                    <b>{name}</b> output <i>{v > 2.5 ? "HIGH" : "LOW"}</i> ({volts(v)})
                  </span>
                );
              }
              if (mode === "output") {
                const on = !!controls.pinHigh[ref]?.[num];
                return (
                  <button key={num} className={`gpio-pin out${on ? " on" : ""}`} onClick={() => update((c) => ({ ...c, pinHigh: { ...c.pinHigh, [ref]: { ...c.pinHigh[ref], [num]: !on } } }))} title={`${name} → ${part.pins[num]}`}>
                    <b>{name}</b> output <i>{on ? "HIGH 5V" : "LOW 0V"}</i>
                  </button>
                );
              }
              return (
                <span key={num} className={`gpio-pin in${v > 2.5 ? " on" : ""}`} title={`${name} ← ${part.pins[num]}`}>
                  <b>{name}</b> {mode === "input_pullup" ? "input + pull-up" : "input"} reads <i>{v > 2.5 ? "HIGH" : "LOW"}</i> ({volts(v)})
                </span>
              );
            })}
          </div>
          {program && part.kind !== "shift_register_74hc595" && (
            <div className="serial">
              <span className="ctl-title">Serial monitor</span>
              <pre>{program.serial || "(nothing printed yet)"}</pre>
            </div>
          )}
        </section>
      );
    }
    default:
      return null;
  }
}

export function Inspector({ selection, onSelect, netlist, layout, result, controls, update, level, summary, onTour }: Props) {
  const parts = useMemo(() => new Map(netlist.parts.map((p) => [p.ref, p])), [netlist]);
  const connections = (net: string) => layout.parts.flatMap((p) => p.pins.filter((q) => q.net === net).map((q) => ({ ref: p.ref, pin: q.number, name: q.name, kind: p.kind })));
  const histKey = selection?.kind === "net" ? `n:${selection.net}` : selection?.kind === "part" ? `p:${selection.ref}` : selection?.kind === "pin" ? `pin:${selection.ref}.${selection.pin}` : "";
  const histValue =
    selection?.kind === "net"
      ? result?.netV[selection.net]
      : selection?.kind === "part"
        ? result?.parts[selection.ref]?.v
        : selection?.kind === "pin"
          ? result?.netV[parts.get(selection.ref)?.pins[selection.pin] ?? ""]
          : undefined;
  const history = useHistory(histKey, histValue, result?.t);

  const close = (
    <button className="icon-btn insp-close" onClick={() => onSelect(null)} aria-label="Close">
      <X size={14} />
    </button>
  );
  const connList = (net: string, skip?: { ref: string; pin: string }) => (
    <div className="conn-list">
      {connections(net)
        .filter((c) => !(skip && c.ref === skip.ref && c.pin === skip.pin))
        .map((c) => (
          <button key={`${c.ref}.${c.pin}`} className="chip-btn" onClick={() => onSelect({ kind: "pin", ref: c.ref, pin: c.pin })}>
            {c.ref} · {kindInfo(c.kind).pin(c.pin, c.name).title}
          </button>
        ))}
    </div>
  );

  if (!selection) {
    const tries: { label: string; act: () => void }[] = [];
    for (const p of netlist.parts) {
      if (p.kind === "push_button") tries.push({ label: `Press ${p.ref} and watch what changes`, act: () => onSelect({ kind: "part", ref: p.ref }) });
      if (p.kind === "potentiometer" && tries.length < 5) tries.push({ label: `Turn ${p.ref}`, act: () => onSelect({ kind: "part", ref: p.ref }) });
    }
    const led = netlist.parts.find((p) => p.kind === "led");
    const res = netlist.parts.find((p) => p.kind === "resistor");
    if (led && res) tries.push({ label: `Make ${res.ref} smaller: does ${led.ref} get brighter?`, act: () => onSelect({ kind: "part", ref: res.ref }) });
    if (led) tries.push({ label: `What's inside ${led.ref}?`, act: () => onSelect({ kind: "part", ref: led.ref }) });
    const mcu = netlist.parts.find((p) => p.kind.startsWith("arduino"));
    if (mcu) tries.push({ label: `Switch ${mcu.ref}'s output pins`, act: () => onSelect({ kind: "part", ref: mcu.ref }) });
    const input = netlist.parts.find((p) => p.kind.startsWith("connector") && /in|control|signal/i.test(p.value) && !/out/i.test(p.value));
    if (input) tries.push({ label: `Change what goes into ${input.ref}`, act: () => onSelect({ kind: "part", ref: input.ref }) });
    return (
      <div className="insp">
        <div className="insp-empty">
          <MousePointerClick size={22} />
          <h3>Click anything</h3>
          <p className="dim">A part, a single pin, a wire, a dot where wires join, even the arrows on an LED. It explains itself, with live numbers from this circuit.</p>
        </div>
        {summary && <p className="insp-summary">{summary}</p>}
        <section className="insp-sec">
          <h4>
            <Footprints size={13} /> Start here
          </h4>
          <button className="btn tour-btn" onClick={onTour}>
            <Zap size={14} /> Follow an electron around the loop
          </button>
          {tries.slice(0, 5).map((t) => (
            <button key={t.label} className="try" onClick={t.act}>
              {t.label}
            </button>
          ))}
        </section>
      </div>
    );
  }

  if (selection.kind === "part" || selection.kind === "detail") {
    const part = parts.get(selection.ref);
    if (!part) return null;
    const info = kindInfo(part.kind);
    const reading = result?.parts[part.ref];
    const value = controls.overrides[part.ref] ?? part.value;
    const pinV = Object.fromEntries(Object.entries(part.pins).map(([num, net]) => [num, result?.netV[net] ?? 0]));
    return (
      <div className="insp" key={part.ref}>
        <header className="insp-head">
          <div>
            <span className="insp-kind">{info.name}</span>
            <h3>
              {part.ref} <span className="dim">{value}</span>
            </h3>
          </div>
          {close}
        </header>
        {selection.kind === "detail" && (
          <section className="insp-sec detail">
            <b>{selection.title}</b>
            <p>{selection.text}</p>
          </section>
        )}
        <p className="insp-what">{info.what[level] || info.what.beginner}</p>
        {part.purpose && (
          <p className="insp-here">
            <b>Here:</b> {part.purpose}.
          </p>
        )}
        {reading && (
          <section className={`insp-live${reading.warn ? " warn" : ""}`}>
            <span className="live-dot" /> {info.live(reading, value)}
            {reading.warn && <div className="warn-line">⚠ {reading.warn}</div>}
          </section>
        )}
        <Spark pts={history} unit="V" />
        <PartControls part={part} controls={controls} update={update} result={result} />
        {info.analogy && <p className="insp-analogy">💡 {info.analogy}</p>}
        <Story kind={part.kind} value={value} reading={reading} pinV={pinV} />
        <section className="insp-sec">
          <h4>Pins</h4>
          <div className="pin-list">
            {Object.entries(part.pinNames)
              .filter(([num]) => layout.parts.find((p) => p.ref === part.ref)?.pins.some((q) => q.number === num))
              .slice(0, 40)
              .map(([num, name]) => {
                const net = part.pins[num];
                return (
                  <button key={num} className="pin-row" onClick={() => onSelect({ kind: "pin", ref: part.ref, pin: num })}>
                    <span>{info.pin(num, name).title || cleanPinName(name) || `pin ${num}`}</span>
                    <span className="dim">{net ? `${net} · ${volts(result?.netV[net] ?? 0)}` : "not connected"}</span>
                  </button>
                );
              })}
          </div>
        </section>
      </div>
    );
  }

  if (selection.kind === "pin") {
    const part = parts.get(selection.ref);
    if (!part) return null;
    const info = kindInfo(part.kind);
    const d = info.pin(selection.pin, part.pinNames[selection.pin] ?? "");
    const net = part.pins[selection.pin];
    const into = result?.pinI[part.ref]?.[selection.pin] ?? 0;
    return (
      <div className="insp" key={`${part.ref}.${selection.pin}`}>
        <header className="insp-head">
          <div>
            <span className="insp-kind">
              pin {selection.pin} of {part.ref} ({info.name})
            </span>
            <h3>{d.title || cleanPinName(part.pinNames[selection.pin] ?? "") || `Pin ${selection.pin}`}</h3>
          </div>
          {close}
        </header>
        {d.text && <p className="insp-what">{d.text}</p>}
        {net ? (
          <section className="insp-live">
            <span className="live-dot" /> At {volts(result?.netV[net] ?? 0)}.{" "}
            {Math.abs(into) > 1e-7 ? (into > 0 ? `${si(into, "A")} of current flows into ${part.ref} here (electrons come out).` : `${si(-into, "A")} of current comes out of ${part.ref} here (electrons go in).`) : "No current through this pin right now."}
          </section>
        ) : (
          <p className="dim">This pin isn't connected to anything.</p>
        )}
        <Spark pts={history} unit="V" />
        {net && (
          <section className="insp-sec">
            <h4>
              Connected by the wire{" "}
              <button className="link" onClick={() => onSelect({ kind: "net", net })}>
                {net}
              </button>{" "}
              to
            </h4>
            {connList(net, { ref: part.ref, pin: selection.pin })}
          </section>
        )}
        <button className="link back" onClick={() => onSelect({ kind: "part", ref: part.ref })}>
          <ArrowLeft size={12} /> {part.ref}
        </button>
      </div>
    );
  }

  if (selection.kind === "net") {
    const d = netInfo(selection.net, [], result?.netV[selection.net]);
    return (
      <div className="insp" key={selection.net}>
        <header className="insp-head">
          <div>
            <span className="insp-kind">wire</span>
            <h3>{d.title}</h3>
          </div>
          {close}
        </header>
        <p className="insp-what">{d.text}</p>
        {selection.current !== undefined && Math.abs(selection.current) > 1e-7 && (
          <section className="insp-live">
            <span className="live-dot" /> This piece of wire carries {si(Math.abs(selection.current), "A")}.
          </section>
        )}
        <Spark pts={history} unit="V" />
        <section className="insp-sec">
          <h4>On this wire</h4>
          {connList(selection.net)}
        </section>
      </div>
    );
  }

  const tiny = TINY[selection.what];
  const part = selection.ref ? parts.get(selection.ref) : undefined;
  return (
    <div className="insp" key={`${selection.what}${selection.net ?? selection.ref ?? ""}`}>
      <header className="insp-head">
        <div>
          <span className="insp-kind">drawing detail</span>
          <h3>{tiny.title}</h3>
        </div>
        {close}
      </header>
      <p className="insp-what">{tiny.text}</p>
      {part && selection.what === "ref" && (
        <p className="insp-here">
          <b>{part.ref}</b>: {kindInfo(part.kind).name}.
        </p>
      )}
      {part && selection.what === "value" && (
        <p className="insp-here">
          <b>{controls.overrides[part.ref] ?? part.value}</b>
          {parseValue(part.value) !== null && ` = ${si(parseValue(controls.overrides[part.ref] ?? part.value)!, part.kind === "resistor" ? "Ω" : part.kind.startsWith("capacitor") ? "F" : "V")}`}
        </p>
      )}
      {selection.net && (
        <section className="insp-sec">
          <h4>
            <button className="link" onClick={() => onSelect({ kind: "net", net: selection.net! })}>
              {selection.net}
            </button>{" "}
            · {volts(result?.netV[selection.net] ?? 0)}
          </h4>
          {connList(selection.net)}
        </section>
      )}
      {part && (
        <button className="link back" onClick={() => onSelect({ kind: "part", ref: part.ref })}>
          <ArrowLeft size={12} /> {part.ref}
        </button>
      )}
    </div>
  );
}

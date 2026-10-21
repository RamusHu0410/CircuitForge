import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { computeFlow, type Flow } from "./flow";
import type { Layout, Netlist } from "./scene";
import { emptyControls, Simulator, type SimControls, type SimResult } from "./sim";

export interface LabSim {
  result: SimResult | null;
  flow: Flow | null;
  controls: SimControls;
  update: (fn: (c: SimControls) => SimControls) => void;
  /** Circuit seconds per real second; null = automatic. */
  speed: number | null;
  setSpeed: (s: number | null) => void;
  effectiveSpeed: number;
  paused: boolean;
  setPaused: (p: boolean) => void;
  restart: () => void;
  dynamic: boolean;
  /** Latest values for per-frame animation (3D particles) without re-rendering React. */
  live: React.RefObject<{ result: SimResult | null; flow: Flow | null }>;
}

/** Runs the circuit: steps the simulator every animation frame and publishes ~15 results a second. */
export function useLabSim(netlist: Netlist, layout: Layout, firmware?: string): LabSim {
  const [controls, setControls] = useState<SimControls>(emptyControls);
  const [snap, setSnap] = useState<{ result: SimResult | null; flow: Flow | null }>({ result: null, flow: null });
  const [speed, setSpeed] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const sim = useMemo(() => new Simulator(netlist, emptyControls(), firmware), [netlist, firmware]);
  const live = useRef<{ result: SimResult | null; flow: Flow | null }>({ result: null, flow: null });
  const controlsRef = useRef(controls);
  controlsRef.current = controls;

  useEffect(() => {
    sim.setControls(controlsRef.current);
  }, [sim, controls]);

  const effectiveSpeed = speed ?? sim.suggestedSpeed();
  const speedRef = useRef(effectiveSpeed);
  speedRef.current = effectiveSpeed;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let published = 0;
    live.current = { result: null, flow: null };
    sim.advance(1e-4);
    const publish = () => {
      const r = sim.result();
      if (r === live.current.result) return; // nothing changed (a still circuit)
      live.current = { result: r, flow: computeFlow(layout, r) };
      setSnap(live.current);
    };
    publish();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!pausedRef.current) sim.advance(dt * speedRef.current);
      if (now - published > 66) {
        published = now;
        publish();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [sim, layout]);

  const update = useCallback((fn: (c: SimControls) => SimControls) => setControls((c) => fn(c)), []);
  const restart = useCallback(() => {
    sim.reset();
    sim.setControls(controlsRef.current);
  }, [sim]);

  return { result: snap.result, flow: snap.flow, controls, update, speed, setSpeed, effectiveSpeed, paused, setPaused, restart, dynamic: sim.dynamic, live };
}

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Box, RotateCcw, ScanEye } from "lucide-react";
import { flowSpeed } from "../../lab/flow";
import { DESK, keyOf, type BreadboardSpec, type Layout, type LayoutPart, type LayoutWire, type Pt } from "../../lab/scene";
import type { LiveState } from "../../lab/useLab";
import { PartModel, Rod, TextSprite, type V3 } from "./parts3d";
import { CURRENT, ELECTRON, selectedRef, voltColor, type ViewProps } from "./types";

type Props = Omit<ViewProps, "scene" | "flow"> & {
  live: React.RefObject<LiveState>;
  /** Which of the live flows belongs to this layout. */
  flowIndex: number;
  values: Record<string, string>; // value overrides, for the models (resistor bands etc.)
  wipers: Record<string, number>;
};

const P = 2.54;
const DOT_SPACING = 2.2;
const LIFT = 0.35; // dots ride just above a flat trace
const STRIP_Y = -1.1; // the breadboard's metal clips, under the holes

type W = (x: number, y: number) => V3;

function Controls({ target, radius, extent, resetKey }: { target: V3; radius: number; extent: [number, number]; resetKey: number }) {
  const { camera, gl, size } = useThree();
  const ref = useRef<OrbitControls | null>(null);
  useEffect(() => {
    const c = new OrbitControls(camera, gl.domElement);
    c.enableDamping = true;
    c.dampingFactor = 0.08;
    c.minDistance = 8;
    c.maxDistance = radius * 6;
    c.screenSpacePanning = true;
    ref.current = c;
    return () => c.dispose();
  }, [camera, gl, radius]);
  // Frame the whole build for this view's shape, looking down at about 50°.
  const aspect = size.width / Math.max(1, size.height);
  useEffect(() => {
    const fov = ((camera as THREE.PerspectiveCamera).fov * Math.PI) / 180;
    const [w, d] = extent;
    const tilt = 0.75;
    const dist = 1.1 * Math.max((d * tilt) / 2 / Math.tan(fov / 2), w / 2 / (Math.tan(fov / 2) * aspect)) + 10;
    const dir = new THREE.Vector3(0, 1, 0.85).normalize();
    camera.position.set(target[0] + dir.x * dist, target[1] + dir.y * dist, target[2] + dir.z * dist);
    camera.lookAt(...target);
    ref.current?.target.set(...target);
    ref.current?.update();
    // only re-frame on reset or when the view changes shape a lot
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, target, extent[0], extent[1], resetKey, Math.round(aspect * 4)]);
  useFrame(() => ref.current?.update());
  return null;
}

/** The arc a jumper wire makes between two holes (the electrons ride the same curve). `ea`/`eb`: how
 *  high each end is plugged in (a battery terminal, an Arduino's header socket). */
function jumperCurve(a: V3, b: V3, ea = 0, eb = 0) {
  const pa = new THREE.Vector3(a[0], 0.2 + ea, a[2]);
  const pb = new THREE.Vector3(b[0], 0.2 + eb, b[2]);
  const top = Math.max(pa.y, pb.y) + Math.min(10, 2.5 + pa.distanceTo(pb) * 0.22);
  return new THREE.CubicBezierCurve3(pa, new THREE.Vector3(pa.x, top, pa.z), new THREE.Vector3(pb.x, top, pb.z), pb);
}

/** Heights of each jumper's ends, by its end points (for the electrons riding it). */
function jumperEnds(layout: Layout) {
  const m = new Map<string, [number, number]>();
  for (const w of layout.wires) {
    if (w.kind !== "jumper" || !w.elev) continue;
    m.set(`${keyOf(w.pts[0])}|${keyOf(w.pts[1])}`, [w.elev[0] ?? 0, w.elev[1] ?? 0]);
    m.set(`${keyOf(w.pts[1])}|${keyOf(w.pts[0])}`, [w.elev[1] ?? 0, w.elev[0] ?? 0]);
  }
  return m;
}

/** Electrons (or conventional current) as glowing dots moving along every path that carries current. */
function Charges({ layout, live, flowIndex, w, electrons, focusNets, xray }: { layout: Layout; live: Props["live"]; flowIndex: number; w: W; electrons: boolean; focusNets: Set<string> | null; xray: boolean }) {
  const MAX = 3000;
  const mesh = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const elevOf = useMemo(() => new Map(layout.parts.map((p) => [p.ref, p.elev ?? 0])), [layout]);
  const lifts = useMemo(() => {
    // How high a part's body sits, so dots go up one leg, across and down the other.
    const m: Record<string, number> = {};
    for (const p of layout.parts) m[p.ref] = { led: 4, resistor: 2.4, diode: 2.4, capacitor: 4, capacitor_polarized: 4, push_button: 1.5, battery: 2, npn_transistor: 4 }[p.kind] ?? 2;
    return m;
  }, [layout]);
  const curves = useMemo(() => new Map<string, THREE.Vector3[]>(), [layout]);
  const ends = useMemo(() => jumperEnds(layout), [layout]);
  useFrame(({ clock }) => {
    const m = mesh.current;
    const flow = live.current?.flows[flowIndex];
    if (!m) return;
    let n = 0;
    if (flow) {
      const t = clock.elapsedTime;
      const paths: { pts: THREE.Vector3[]; i: number }[] = [];
      for (const s of flow.segments) {
        if (focusNets && !focusNets.has(s.net)) continue;
        if (s.kind === "strip" && !xray) continue; // inside the board: only seen with x-ray
        const a = w(s.a[0], s.a[1]);
        const b = w(s.b[0], s.b[1]);
        let pts: THREE.Vector3[];
        if (s.kind === "jumper") {
          const key = `${keyOf(s.a)}|${keyOf(s.b)}`;
          const [ea, eb] = ends.get(key) ?? [0, 0];
          if (!curves.has(key)) curves.set(key, jumperCurve(a, b, ea, eb).getPoints(18).map((p) => p.add(new THREE.Vector3(0, 0.45, 0))));
          pts = curves.get(key)!;
        } else {
          const y = s.kind === "strip" ? STRIP_Y + 0.3 : LIFT;
          pts = [new THREE.Vector3(a[0], y, a[2]), new THREE.Vector3(b[0], y, b[2])];
        }
        paths.push({ pts, i: s.i });
      }
      for (const s of flow.through) {
        const a = w(s.a[0], s.a[1]);
        const b = w(s.b[0], s.b[1]);
        const e = elevOf.get(s.ref) ?? 0;
        if (e) continue; // inside a battery or an Arduino on the desk: not drawn
        const h = lifts[s.ref] ?? 2;
        paths.push({ pts: [new THREE.Vector3(a[0], LIFT, a[2]), new THREE.Vector3(a[0], h, a[2]), new THREE.Vector3(b[0], h, b[2]), new THREE.Vector3(b[0], LIFT, b[2])], i: s.i });
      }
      for (const { pts, i } of paths) {
        const speed = flowSpeed(i);
        if (!speed) continue;
        const forward = i > 0 !== electrons;
        const seq = forward ? pts : [...pts].reverse();
        const lens = seq.slice(1).map((p, k) => p.distanceTo(seq[k]));
        const total = lens.reduce((a, b) => a + b, 0);
        if (total < 0.1) continue;
        const offset = (t * speed) % DOT_SPACING;
        for (let d = offset; d < total && n < MAX; d += DOT_SPACING) {
          let rest = d;
          let k = 0;
          while (k < lens.length - 1 && rest > lens[k]) rest -= lens[k++];
          dummy.position.copy(seq[k]).lerp(seq[k + 1], lens[k] ? rest / lens[k] : 0);
          dummy.updateMatrix();
          m.setMatrixAt(n++, dummy.matrix);
        }
      }
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
  });
  const color = electrons ? ELECTRON : CURRENT;
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, MAX]} frustumCulled={false} renderOrder={5}>
      <sphereGeometry args={[0.38, 10, 8]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.4} toneMapped={false} depthTest={!xray} />
    </instancedMesh>
  );
}

function TourDot({ at, w, electrons }: { at: Pt; w: W; electrons: boolean }) {
  const p = w(at[0], at[1]);
  const color = electrons ? ELECTRON : CURRENT;
  return (
    <group position={[p[0], 1.6, p[2]]}>
      <mesh>
        <sphereGeometry args={[1.1, 20, 16]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={2.5} toneMapped={false} />
      </mesh>
      <pointLight color={color} intensity={40} distance={16} />
    </group>
  );
}

function Selectable({ part, selected, dim, onSelect, children, w }: { part: LayoutPart; selected: boolean; dim: boolean; onSelect: () => void; children: React.ReactNode; w: W }) {
  const [hover, setHover] = useState(false);
  const [x0, y0, x1, y1] = part.bbox;
  const a = w(x0, y0);
  const b = w(x1, y1);
  return (
    <group
      onClick={(e: ThreeEvent<MouseEvent>) => {
        if (e.delta > 4) return; // that was an orbit drag, not a click
        e.stopPropagation();
        onSelect();
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHover(true);
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        setHover(false);
        document.body.style.cursor = "";
      }}
    >
      {children}
      {(selected || hover || dim) && (
        <mesh position={[(a[0] + b[0]) / 2, 0.08, (a[2] + b[2]) / 2]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[Math.abs(b[0] - a[0]) + 2, Math.abs(b[2] - a[2]) + 2]} />
          <meshBasicMaterial color={dim ? "#000" : "#3a9be8"} transparent opacity={dim ? 0.3 : selected ? 0.4 : 0.16} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}

/* ---------- what the circuit sits on ---------- */

/** A solderless breadboard: holes, rails with their red/blue lines, the centre channel. */
function Breadboard({ spec, w, xray }: { spec: BreadboardSpec; w: W; xray: boolean }) {
  const ys = spec.rails.map((r) => r.y);
  const yTop = Math.min(...ys) - 1.6 * P;
  const yBot = Math.max(...ys) + 1.6 * P;
  const xL = -1.6 * P;
  const xR = (spec.columns + 0.6) * P;
  const [ax, , az] = w(xL, yTop);
  const [bx, , bz] = w(xR, yBot);
  const holes = useMemo(() => {
    const out: Pt[] = [];
    const rows = [0, 1, 2, 3, 4, 7, 8, 9, 10, 11].map((r) => r * P);
    for (let c = 0; c < spec.columns; c++) {
      for (const y of rows) out.push([c * P, y]);
      if (c % 6 !== 5) for (const r of spec.rails) out.push([c * P, r.y]);
    }
    return out;
  }, [spec]);
  const holeMesh = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const m = holeMesh.current;
    if (!m) return;
    const d = new THREE.Object3D();
    holes.forEach((h, i) => {
      const [x, , z] = w(h[0], h[1]);
      d.position.set(x, 0.02, z);
      d.updateMatrix();
      m.setMatrixAt(i, d.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  }, [holes, w]);
  const channel = w(0, 5.5 * P);
  return (
    <group>
      <mesh position={[(ax + bx) / 2, -4.25, (az + bz) / 2]} receiveShadow>
        <boxGeometry args={[bx - ax, 8.5, bz - az]} />
        <meshStandardMaterial color="#f3f1ea" roughness={0.75} transparent={xray} opacity={xray ? 0.22 : 1} depthWrite={!xray} />
      </mesh>
      <mesh position={[(ax + bx) / 2, -0.6, channel[2]]}>
        <boxGeometry args={[bx - ax, 1.3, 1.8]} />
        <meshStandardMaterial color="#d9d6cc" roughness={0.9} transparent={xray} opacity={xray ? 0.2 : 1} />
      </mesh>
      <instancedMesh ref={holeMesh} args={[undefined, undefined, holes.length]} visible={!xray}>
        <boxGeometry args={[1.05, 0.05, 1.05]} />
        <meshStandardMaterial color="#3a3a3c" />
      </instancedMesh>
      {spec.rails.map((r, i) => {
        // Each rail's coloured line runs beside its holes: outside for the outer rail, inside for the inner one.
        const pair = spec.rails.filter((q) => q.y < 0 === r.y < 0);
        const outer = Math.abs(r.y) === Math.max(...pair.map((q) => Math.abs(q.y)));
        const side = (r.y < 0 ? -1 : 1) * (outer ? 1 : -1);
        const [, , z] = w(0, r.y + side * 0.6 * P);
        return (
          <group key={i}>
            <mesh position={[(ax + bx) / 2, 0.03, z]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[bx - ax - 4, 0.35]} />
              <meshBasicMaterial color={r.sign === "+" ? "#d93b2b" : "#2f6fd8"} />
            </mesh>
            <TextSprite text={r.sign === "+" ? "+" : "−"} position={[ax + 1.6, 0.8, w(0, r.y)[2]]} size={2.4} color={r.sign === "+" ? "#d93b2b" : "#2f6fd8"} />
          </group>
        );
      })}
      {[0, 4, 9, 14, 19, 24, 29, 34, 39, 44, 49, 54, 59].filter((c) => c < spec.columns).map((c) => (
        <TextSprite key={c} text={String(c + 1)} position={[w(c * P, 0)[0], 0.4, w(0, -1.15 * P)[2]]} size={1.2} color="#8a8478" />
      ))}
      {"abcdefghij".split("").map((r, i) => (
        <TextSprite key={r} text={r} position={[w(-1.05 * P, 0)[0], 0.4, w(0, [0, 1, 2, 3, 4, 7, 8, 9, 10, 11][i] * P)[2]]} size={1.2} color="#8a8478" />
      ))}
    </group>
  );
}

/** The desk everything stands on (under the breadboard, or the circuit's own surface without one). */
function Desk({ layout, w, y }: { layout: Layout; w: W; y: number }) {
  const [x0, y0, x1, y1] = layout.bbox;
  const [ax, , az] = w(x0, y0);
  const [bx, , bz] = w(x1, y1);
  return (
    <mesh position={[(ax + bx) / 2, y - 0.05, (az + bz) / 2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[(bx - ax) * 1.6 + 40, (bz - az) * 1.6 + 40]} />
      <meshStandardMaterial color="#d8d3c8" roughness={0.95} />
    </mesh>
  );
}

function Jumper({ a, b, ea, eb, color, onClick }: { a: V3; b: V3; ea: number; eb: number; color: string; onClick: (e: ThreeEvent<MouseEvent>) => void }) {
  const geom = useMemo(() => new THREE.TubeGeometry(jumperCurve(a, b, ea, eb), 28, 0.42, 8, false), [a, b, ea, eb]);
  return (
    <mesh geometry={geom} castShadow onClick={onClick}>
      <meshStandardMaterial color={color} roughness={0.45} />
    </mesh>
  );
}

function Wires({ layout, w, color, focusNets, xray, onSelect }: { layout: Layout; w: W; color: (wire: LayoutWire) => string; focusNets: Set<string> | null; xray: boolean; onSelect: Props["onSelect"] }) {
  return (
    <>
      {layout.wires.map((wire, i) =>
        wire.pts.slice(1).map((q, k) => {
          const pa = w(wire.pts[k][0], wire.pts[k][1]);
          const pb = w(q[0], q[1]);
          const dim = !!focusNets && !focusNets.has(wire.net);
          const click = (e: ThreeEvent<MouseEvent>) => {
            if (e.delta > 4) return;
            e.stopPropagation();
            onSelect({ kind: "net", net: wire.net });
          };
          const key = `${i}-${k}`;
          if (wire.kind === "jumper") return <Jumper key={key} a={pa} b={pb} ea={wire.elev?.[k] ?? 0} eb={wire.elev?.[k + 1] ?? 0} color={dim ? "#aaa" : color(wire)} onClick={click} />;
          if (wire.kind === "strip") {
            if (!xray) return null;
            return <Rod key={key} a={[pa[0], STRIP_Y, pa[2]]} b={[pb[0], STRIP_Y, pb[2]]} r={0.45} color={dim ? "#888" : color(wire)} />;
          }
          const len = Math.hypot(pb[0] - pa[0], pb[2] - pa[2]);
          return (
            <mesh key={key} position={[(pa[0] + pb[0]) / 2, 0.05, (pa[2] + pb[2]) / 2]} rotation={[0, -Math.atan2(pb[2] - pa[2], pb[0] - pa[0]), 0]} onClick={click}>
              <boxGeometry args={[len + 0.8, 0.12, 0.8]} />
              <meshStandardMaterial color={color(wire)} metalness={0.6} roughness={0.35} transparent={dim} opacity={dim ? 0.3 : 1} />
            </mesh>
          );
        }),
      )}
    </>
  );
}

/** Clickable spots on every leg, so a single pin can be picked in 3D too. */
function PinTargets({ layout, w, onSelect }: { layout: Layout; w: W; onSelect: Props["onSelect"] }) {
  return (
    <>
      {layout.parts.flatMap((part) =>
        part.pins.map((pin) => {
          const p = w(pin.at[0], pin.at[1]);
          const lift = part.elev === undefined ? 0.6 : part.kind === "battery" ? part.elev + 11.3 : part.elev + 11.7;
          return (
            <mesh key={`${part.ref}.${pin.number}`} position={[p[0], lift, p[2]]} onClick={(e) => e.delta < 4 && (e.stopPropagation(), onSelect({ kind: "pin", ref: part.ref, pin: pin.number }))}>
              <sphereGeometry args={[0.8, 8, 6]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>
          );
        }),
      )}
    </>
  );
}

export function Circuit3D(props: Props) {
  const { layout, result, selection, onSelect, electrons, showFlow, showVolts, focus, tourDot, pressed, onPress, live, flowIndex, values, wipers } = props;
  const [x0, y0, x1, y1] = layout.bbox;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const radius = Math.max(48, Math.hypot(x1 - x0, y1 - y0) * 0.8);
  const w = useMemo(() => (x: number, y: number): V3 => [x - cx, 0, y - cy], [cx, cy]);
  const [resetKey, setResetKey] = useState(0);
  const [xray, setXray] = useState(false);
  const selRef = selectedRef(selection);
  const selNet = selection?.kind === "net" ? selection.net : null;
  const target = useMemo<V3>(() => [0, 0, 0], []);
  const vmax = Math.max(0.1, ...Object.values(result?.netV ?? {}));
  const wireColor = (wire: LayoutWire) =>
    showVolts && result ? voltColor(result.netV[wire.net] ?? 0, vmax) : selNet === wire.net ? "#3a9be8" : wire.kind === "strip" ? "#c9ced6" : (wire.color ?? "#d39a4c");

  return (
    <div className="c3d-wrap">
      <Canvas shadows dpr={[1, 2]} camera={{ fov: 40, near: 1, far: 5000 }} gl={{ antialias: true }} onPointerMissed={() => onSelect(null)}>
        <color attach="background" args={["#e9edf2"]} />
        <hemisphereLight args={["#ffffff", "#8a93a0", 0.9]} />
        <directionalLight position={[radius * 0.6, radius * 1.4, radius * 0.4]} intensity={1.6} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-radius} shadow-camera-right={radius} shadow-camera-top={radius} shadow-camera-bottom={-radius} />
        <Controls target={target} radius={radius} extent={[x1 - x0 + 6, y1 - y0 + 6]} resetKey={resetKey} />
        {layout.board && <Breadboard spec={layout.board} w={w} xray={xray} />}
        <Desk layout={layout} w={w} y={layout.board ? DESK : 0} />
        <Wires layout={layout} w={w} color={wireColor} focusNets={focus?.nets ?? null} xray={xray} onSelect={onSelect} />
        {layout.parts.map((part) => {
          const value = values[part.ref] ?? part.value;
          return (
            <group key={part.ref} position={[0, part.elev ?? 0, 0]}>
              <Selectable part={part} selected={selRef === part.ref} dim={!!focus && !focus.refs.has(part.ref)} onSelect={() => onSelect({ kind: "part", ref: part.ref })} w={w}>
                <PartModel part={part} reading={result?.parts[part.ref]} w={w} value={value} wiper={wipers[part.ref] ?? 0.5} pressed={!!pressed[part.ref]} onPress={(down) => onPress(part.ref, down)} />
                <TextSprite text={part.ref} position={[w(part.center[0], 0)[0], part.elev !== undefined ? 16 : 10, w(0, part.bbox[1])[2]]} size={2} color="#1f1f1f" />
              </Selectable>
            </group>
          );
        })}
        <PinTargets layout={layout} w={w} onSelect={onSelect} />
        {showFlow && <Charges layout={layout} live={live} flowIndex={flowIndex} w={w} electrons={electrons} focusNets={focus?.nets ?? null} xray={xray} />}
        {tourDot && <TourDot at={tourDot} w={w} electrons={electrons} />}
      </Canvas>
      <div className="view-tools">
        <button className="icon-btn" onClick={() => setResetKey((k) => k + 1)} aria-label="Reset camera" title="Reset camera">
          <RotateCcw size={14} />
        </button>
        {layout.board && (
          <button className={`icon-btn${xray ? " on" : ""}`} onClick={() => setXray(!xray)} aria-pressed={xray} title="See inside the breadboard: the metal strips that join its holes">
            <ScanEye size={14} />
          </button>
        )}
        <span className="view-hint">
          <Box size={12} /> {xray ? "x-ray: the metal strips inside the breadboard" : "drag to orbit · right-drag to pan · scroll to zoom"}
        </span>
      </div>
    </div>
  );
}

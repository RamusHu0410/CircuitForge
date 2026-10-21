import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Box, RotateCcw } from "lucide-react";
import { flowSpeed, type Flow } from "../../lab/flow";
import type { Layout, LayoutPart, Pt } from "../../lab/scene";
import type { SimResult } from "../../lab/sim";
import { PartModel, Rod, TextSprite, type V3 } from "./parts3d";
import { CURRENT, ELECTRON, selectedRef, voltColor, type ViewProps } from "./types";

type Props = Omit<ViewProps, "scene"> & {
  live: React.RefObject<{ result: SimResult | null; flow: Flow | null }>;
  values: Record<string, string>; // value overrides, for the models (resistor bands etc.)
  wipers: Record<string, number>;
  /** Draw jumper wires as arcs (the practice builder) instead of flat traces. */
  jumpers?: boolean;
};

const DOT_SPACING = 2.2;
const LIFT = 0.35; // dots ride just above the copper

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
  // Frame the whole board for this view's shape, looking down at about 50°.
  const aspect = size.width / Math.max(1, size.height);
  useEffect(() => {
    const fov = ((camera as THREE.PerspectiveCamera).fov * Math.PI) / 180;
    const [w, d] = extent;
    const tilt = 0.75; // the board looks shorter when tilted
    const dist = 1.12 * Math.max((d * tilt) / 2 / Math.tan(fov / 2), w / 2 / (Math.tan(fov / 2) * aspect)) + 12;
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

/** Electrons (or conventional current) as glowing dots moving along every path that carries current. */
function Charges({ layout, live, w, electrons, focusNets, jumpers }: { layout: Layout; live: Props["live"]; w: (x: number, y: number) => V3; electrons: boolean; focusNets: Set<string> | null; jumpers?: boolean }) {
  const MAX = 3000;
  const mesh = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const lifts = useMemo(() => {
    // How high a part's body sits, so dots go up one leg, across and down the other.
    const m: Record<string, number> = {};
    for (const p of layout.parts) m[p.ref] = { led: 4, resistor: 2.4, diode: 2.4, capacitor: 4, capacitor_polarized: 4, push_button: 1.5, battery: 2, npn_transistor: 4 }[p.kind] ?? 2;
    return m;
  }, [layout]);
  useFrame(({ clock }) => {
    const m = mesh.current;
    const flow = live.current?.flow;
    if (!m) return;
    let n = 0;
    if (flow) {
      const t = clock.elapsedTime;
      const paths: { pts: THREE.Vector3[]; i: number }[] = [];
      for (const s of flow.segments) {
        if (focusNets && !focusNets.has(s.net)) continue;
        const a = w(s.a[0], s.a[1]);
        const b = w(s.b[0], s.b[1]);
        const pts = jumpers ? jumperCurve(a, b).getPoints(16).map((p) => p.add(new THREE.Vector3(0, 0.5, 0))) : [new THREE.Vector3(a[0], LIFT, a[2]), new THREE.Vector3(b[0], LIFT, b[2])];
        paths.push({ pts, i: s.i });
      }
      for (const s of flow.through) {
        const a = w(s.a[0], s.a[1]);
        const b = w(s.b[0], s.b[1]);
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
          const p = seq[k].clone().lerp(seq[k + 1], lens[k] ? rest / lens[k] : 0);
          dummy.position.copy(p);
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
    <instancedMesh ref={mesh} args={[undefined, undefined, MAX]} frustumCulled={false}>
      <sphereGeometry args={[0.38, 10, 8]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.4} toneMapped={false} />
    </instancedMesh>
  );
}

function TourDot({ at, w, electrons }: { at: Pt; w: (x: number, y: number) => V3; electrons: boolean }) {
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

function Selectable({ part, selected, dim, onSelect, children, w }: { part: LayoutPart; selected: boolean; dim: boolean; onSelect: () => void; children: React.ReactNode; w: (x: number, y: number) => V3 }) {
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
        <mesh position={[(a[0] + b[0]) / 2, 0.06, (a[2] + b[2]) / 2]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[Math.abs(b[0] - a[0]) + 3, Math.abs(b[2] - a[2]) + 3]} />
          <meshBasicMaterial color={dim ? "#000" : "#3a9be8"} transparent opacity={dim ? 0.35 : selected ? 0.45 : 0.18} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}

function Board({ layout, result, showVolts, selNet, focusNets, w, onSelect, jumpers }: { layout: Layout; result: SimResult | null; showVolts: boolean; selNet: string | null; focusNets: Set<string> | null; w: (x: number, y: number) => V3; onSelect: Props["onSelect"]; jumpers?: boolean }) {
  const [x0, y0, x1, y1] = layout.bbox;
  const a = w(x0, y0);
  const b = w(x1, y1);
  const vmax = Math.max(0.1, ...Object.values(result?.netV ?? {}));
  const traceColor = (net: string) => (showVolts && result ? voltColor(result.netV[net] ?? 0, vmax) : selNet === net ? "#ffd27a" : "#d39a4c");
  return (
    <>
      <mesh position={[(a[0] + b[0]) / 2, -0.8, (a[2] + b[2]) / 2]} receiveShadow onClick={(e) => e.delta < 4 && onSelect(null)}>
        <boxGeometry args={[Math.abs(b[0] - a[0]) + 10, 1.6, Math.abs(b[2] - a[2]) + 10]} />
        <meshStandardMaterial color={jumpers ? "#efeee8" : "#1f5f3f"} roughness={0.8} />
      </mesh>
      {layout.wires.map((wire, i) =>
        wire.pts.slice(1).map((q, k) => {
          const p = wire.pts[k];
          const pa = w(p[0], p[1]);
          const pb = w(q[0], q[1]);
          const len = Math.hypot(pb[0] - pa[0], pb[2] - pa[2]);
          const dim = focusNets && !focusNets.has(wire.net);
          const click = (e: ThreeEvent<MouseEvent>) => {
            if (e.delta > 4) return;
            e.stopPropagation();
            onSelect({ kind: "net", net: wire.net });
          };
          if (jumpers)
            return <Jumper key={`${i}-${k}`} a={pa} b={pb} color={traceColor(wire.net)} onClick={click} />;
          return (
            <mesh key={`${i}-${k}`} position={[(pa[0] + pb[0]) / 2, 0.05, (pa[2] + pb[2]) / 2]} rotation={[0, -Math.atan2(pb[2] - pa[2], pb[0] - pa[0]), 0]} onClick={click}>
              <boxGeometry args={[len + 0.8, 0.12, 0.8]} />
              <meshStandardMaterial color={traceColor(wire.net)} metalness={showVolts ? 0.1 : 0.7} roughness={0.35} transparent={!!dim} opacity={dim ? 0.3 : 1} />
            </mesh>
          );
        }),
      )}
      {layout.junctions.map((j, i) => {
        const p = w(j.at[0], j.at[1]);
        return (
          <mesh key={i} position={[p[0], 0.12, p[2]]} onClick={(e) => e.delta < 4 && (e.stopPropagation(), onSelect({ kind: "tiny", what: "junction", net: j.net }))}>
            <cylinderGeometry args={[0.9, 0.9, 0.14, 16]} />
            <meshStandardMaterial color={traceColor(j.net)} metalness={0.7} roughness={0.35} />
          </mesh>
        );
      })}
      {layout.parts.flatMap((part) =>
        part.pins.map((pin) => {
          const p = w(pin.at[0], pin.at[1]);
          return (
            <mesh key={`${part.ref}.${pin.number}`} position={[p[0], 0.1, p[2]]} onClick={(e) => e.delta < 4 && (e.stopPropagation(), onSelect({ kind: "pin", ref: part.ref, pin: pin.number }))}>
              <cylinderGeometry args={[0.85, 0.85, 0.16, 16]} />
              <meshStandardMaterial color="#e7c27a" metalness={0.8} roughness={0.3} />
            </mesh>
          );
        }),
      )}
      {layout.ports.map((port, i) => {
        const p = w(port.at[0], port.at[1]);
        const color = port.ground ? "#202124" : "#d93b2b";
        return (
          <group key={i} position={[p[0], 0, p[2]]} onClick={(e) => e.delta < 4 && (e.stopPropagation(), onSelect({ kind: "tiny", what: port.ground ? "ground" : "supply", net: port.net }))}>
            <mesh position={[0, 1.6, 0]} castShadow>
              <cylinderGeometry args={[0.9, 1.1, 3.2, 16]} />
              <meshStandardMaterial color={color} roughness={0.4} />
            </mesh>
            <TextSprite text={port.net} position={[0, 4.6, 0]} size={1.8} color={port.ground ? "#202124" : "#b3261e"} />
          </group>
        );
      })}
      {layout.labels.map((l, i) => {
        const p = w(l.at[0], l.at[1]);
        return <TextSprite key={i} text={l.net} position={[p[0], 1.6, p[2]]} size={1.4} color="#e9ecef" />;
      })}
    </>
  );
}

/** The arc a jumper wire makes between two board points (the electrons ride the same curve). */
function jumperCurve(a: V3, b: V3) {
  const pa = new THREE.Vector3(a[0], 0.4, a[2]);
  const pb = new THREE.Vector3(b[0], 0.4, b[2]);
  const h = Math.min(8, 2 + pa.distanceTo(pb) * 0.25);
  return new THREE.CubicBezierCurve3(pa, pa.clone().add(new THREE.Vector3(0, h, 0)), pb.clone().add(new THREE.Vector3(0, h, 0)), pb);
}

function Jumper({ a, b, color, onClick }: { a: V3; b: V3; color: string; onClick: (e: ThreeEvent<MouseEvent>) => void }) {
  const geom = useMemo(() => new THREE.TubeGeometry(jumperCurve(a, b), 24, 0.45, 8, false), [a, b]);
  return (
    <mesh geometry={geom} castShadow onClick={onClick}>
      <meshStandardMaterial color={color} roughness={0.45} />
    </mesh>
  );
}

export function Circuit3D(props: Props) {
  const { layout, result, selection, onSelect, electrons, showFlow, showVolts, focus, tourDot, pressed, onPress, live, values, wipers, jumpers } = props;
  const [x0, y0, x1, y1] = layout.bbox;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const radius = Math.max(48, Math.hypot(x1 - x0, y1 - y0) * 0.8);
  const w = useMemo(() => (x: number, y: number): V3 => [x - cx, 0, y - cy], [cx, cy]);
  const [resetKey, setResetKey] = useState(0);
  const selRef = selectedRef(selection);
  const selNet = selection?.kind === "net" ? selection.net : null;
  const target = useMemo<V3>(() => [0, 0, 0], []);

  return (
    <div className="c3d-wrap">
      <Canvas shadows dpr={[1, 2]} camera={{ fov: 40, near: 1, far: 5000 }} gl={{ antialias: true }}>
        <color attach="background" args={["#e9edf2"]} />
        <hemisphereLight args={["#ffffff", "#8a93a0", 0.9]} />
        <directionalLight position={[radius * 0.6, radius * 1.4, radius * 0.4]} intensity={1.6} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-radius} shadow-camera-right={radius} shadow-camera-top={radius} shadow-camera-bottom={-radius} />
        <Controls target={target} radius={radius} extent={[x1 - x0 + 10, y1 - y0 + 10]} resetKey={resetKey} />
        <Board layout={layout} result={result} showVolts={showVolts} selNet={selNet} focusNets={focus?.nets ?? null} w={w} onSelect={onSelect} jumpers={jumpers} />
        {layout.parts.map((part) => {
          const value = values[part.ref] ?? part.value;
          const [px0, py0] = part.bbox;
          const labelAt = w(px0, py0 - 1.5);
          return (
            <Selectable key={part.ref} part={part} selected={selRef === part.ref} dim={!!focus && !focus.refs.has(part.ref)} onSelect={() => onSelect({ kind: "part", ref: part.ref })} w={w}>
              <PartModel part={part} reading={result?.parts[part.ref]} w={w} value={value} wiper={wipers[part.ref] ?? 0.5} pressed={!!pressed[part.ref]} onPress={(down) => onPress(part.ref, down)} />
              <TextSprite text={part.ref} position={[labelAt[0] + 2, 9, labelAt[2]]} size={2} color="#1f1f1f" />
            </Selectable>
          );
        })}
        {showFlow && <Charges layout={layout} live={live} w={w} electrons={electrons} focusNets={focus?.nets ?? null} jumpers={jumpers} />}
        {tourDot && <TourDot at={tourDot} w={w} electrons={electrons} />}
        {/* the selected wire, highlighted along its whole route */}
        {selNet &&
          layout.wires
            .filter((x) => x.net === selNet)
            .flatMap((x, i) =>
              x.pts.slice(1).map((q, k) => {
                const [ax, , az] = w(x.pts[k][0], x.pts[k][1]);
                const [bx, , bz] = w(q[0], q[1]);
                return <Rod key={`${i}-${k}`} a={[ax, 0.3, az]} b={[bx, 0.3, bz]} r={0.5} color="#3a9be8" metal={false} />;
              }),
            )}
      </Canvas>
      <div className="view-tools">
        <button className="icon-btn" onClick={() => setResetKey((k) => k + 1)} aria-label="Reset camera" title="Reset camera">
          <RotateCcw size={14} />
        </button>
        <span className="view-hint">
          <Box size={12} /> drag to orbit · right-drag to pan · scroll to zoom
        </span>
      </div>
    </div>
  );
}

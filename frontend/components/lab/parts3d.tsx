/**
 * Physical-looking 3D parts, built from simple shapes. Every model stands on the board with its
 * legs exactly on the part's pin positions from the schematic, so the 2D and 3D views line up.
 * World coordinates: x and z follow the schematic (mm), y is up, the board's top is y = 0.
 */

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import type { LayoutPart } from "../../lab/scene";
import type { PartReading } from "../../lab/sim";
import { LED_RGB, ledColor, parseValue, resistorBands } from "../../lab/values";

export type V3 = [number, number, number];

const UP = new THREE.Vector3(0, 1, 0);

/** A cylinder from a to b (leads, wires). */
export function Rod({ a, b, r = 0.3, color = "#c9ced6", metal = true }: { a: V3; b: V3; r?: number; color?: string; metal?: boolean }) {
  const { pos, quat, len } = useMemo(() => {
    const va = new THREE.Vector3(...a);
    const vb = new THREE.Vector3(...b);
    const dir = vb.clone().sub(va);
    const len = dir.length();
    const quat = new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize());
    return { pos: va.add(vb).multiplyScalar(0.5), quat, len };
  }, [a, b]);
  if (len < 1e-6) return null;
  return (
    <mesh position={pos} quaternion={quat} castShadow>
      <cylinderGeometry args={[r, r, len, 10]} />
      <meshStandardMaterial color={color} metalness={metal ? 0.85 : 0.1} roughness={metal ? 0.3 : 0.6} />
    </mesh>
  );
}

/** A leg from the board straight up, then over to a point on the body. */
function Leg({ pin, to, r = 0.3, color }: { pin: V3; to: V3; r?: number; color?: string }) {
  const knee: V3 = [pin[0], to[1], pin[2]];
  return (
    <>
      <Rod a={[pin[0], -1.6, pin[2]]} b={knee} r={r} color={color} /> {/* down into the hole */}
      <Rod a={knee} b={to} r={r} color={color} />
      <mesh position={knee} castShadow>
        <sphereGeometry args={[r, 8, 8]} />
        <meshStandardMaterial color={color ?? "#c9ced6"} metalness={0.85} roughness={0.3} />
      </mesh>
    </>
  );
}

export interface PartModelProps {
  part: LayoutPart;
  reading: PartReading | undefined;
  /** schematic (x, y) → world [x, 0, z] */
  w: (x: number, y: number) => V3;
  value: string;
  wiper: number;
  pressed: boolean;
  onPress: (down: boolean) => void;
}

function axis(a: V3, b: V3) {
  const dx = b[0] - a[0];
  const dz = b[2] - a[2];
  const len = Math.hypot(dx, dz) || 1;
  return { mid: [(a[0] + b[0]) / 2, 0, (a[2] + b[2]) / 2] as V3, len, angle: Math.atan2(dz, dx), ux: dx / len, uz: dz / len };
}

function pinsOf(p: PartModelProps) {
  return Object.fromEntries(p.part.pins.map((pin) => [pin.number, p.w(pin.at[0], pin.at[1])])) as Record<string, V3>;
}

/* ---------- two-lead axial parts ---------- */

function Axial({ p, body, bands, stripeAt, radius }: { p: PartModelProps; body: string; bands?: string[]; stripeAt?: "1" | "2"; radius: number }) {
  const pins = pinsOf(p);
  const a = pins["1"];
  const b = pins["2"];
  const { mid, len, angle, ux, uz } = axis(a, b);
  const h = radius + 1.2;
  const bodyLen = Math.min(6.4, len * 0.62);
  const endA: V3 = [mid[0] - (ux * bodyLen) / 2, h, mid[2] - (uz * bodyLen) / 2];
  const endB: V3 = [mid[0] + (ux * bodyLen) / 2, h, mid[2] + (uz * bodyLen) / 2];
  const warm = Math.min(1, (p.reading?.p ?? 0) / 0.25);
  return (
    <>
      <Leg pin={a} to={endA} />
      <Leg pin={b} to={endB} />
      <group position={[mid[0], h, mid[2]]} rotation={[0, -angle, Math.PI / 2]}>
        <mesh castShadow>
          <capsuleGeometry args={[radius, bodyLen - radius * 2, 6, 18]} />
          <meshStandardMaterial color={body} roughness={0.55} emissive="#ff4a10" emissiveIntensity={warm * 0.6} />
        </mesh>
        {bands?.map((c, i) => (
          <mesh key={i} position={[0, -bodyLen * 0.28 + i * (bodyLen * 0.17) + (i === 3 ? bodyLen * 0.08 : 0), 0]}>
            <cylinderGeometry args={[radius + 0.04, radius + 0.04, 0.5, 18]} />
            <meshStandardMaterial color={c} roughness={0.5} metalness={i === 3 ? 0.6 : 0} />
          </mesh>
        ))}
        {stripeAt && (
          <mesh position={[0, (stripeAt === "1" ? -1 : 1) * bodyLen * 0.32, 0]}>
            <cylinderGeometry args={[radius + 0.04, radius + 0.04, 0.7, 18]} />
            <meshStandardMaterial color="#d8dde4" metalness={0.5} roughness={0.4} />
          </mesh>
        )}
      </group>
    </>
  );
}

/* ---------- LED ---------- */

function Led(p: PartModelProps) {
  const pins = pinsOf(p);
  const k = pins["1"];
  const an = pins["2"];
  const { mid, ux, uz } = axis(k, an);
  const color = LED_RGB[ledColor(p.value)];
  const level = Math.min(1.3, p.reading?.level ?? 0);
  const base = 4;
  const legK: V3 = [mid[0] - ux * 0.8, base, mid[2] - uz * 0.8];
  const legA: V3 = [mid[0] + ux * 0.8, base, mid[2] + uz * 0.8];
  const light = useRef<THREE.PointLight>(null);
  return (
    <>
      <Leg pin={k} to={legK} r={0.25} />
      <Leg pin={an} to={legA} r={0.25} />
      <group position={[mid[0], base, mid[2]]}>
        <mesh position={[0, 0.5, 0]}>
          <cylinderGeometry args={[1.9, 1.9, 0.8, 28]} />
          <meshStandardMaterial color={color} transparent opacity={0.75} roughness={0.15} emissive={color} emissiveIntensity={level * 1.6} />
        </mesh>
        <mesh position={[0, 2.6, 0]}>
          <cylinderGeometry args={[1.55, 1.55, 3.4, 28]} />
          <meshStandardMaterial color={color} transparent opacity={0.55} roughness={0.08} emissive={color} emissiveIntensity={level * 2.2} />
        </mesh>
        <mesh position={[0, 4.3, 0]}>
          <sphereGeometry args={[1.55, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color={color} transparent opacity={0.55} roughness={0.08} emissive={color} emissiveIntensity={level * 2.2} />
        </mesh>
        {/* the tiny chip in its cup, on the cathode post */}
        <mesh position={[-ux * 0.35, 1.9, -uz * 0.35]}>
          <boxGeometry args={[0.5, 0.3, 0.5]} />
          <meshStandardMaterial color={level > 0.05 ? "#ffffff" : "#555"} emissive={color} emissiveIntensity={level * 4} />
        </mesh>
        {level > 0.02 && <pointLight ref={light} position={[0, 4, 0]} color={color} intensity={level * 60} distance={30} decay={2} />}
        {level > 0.02 && (
          <sprite position={[0, 3.4, 0]} scale={[10 * Math.min(1, level), 10 * Math.min(1, level), 1]}>
            <spriteMaterial map={glowTexture()} color={color} transparent depthWrite={false} blending={THREE.AdditiveBlending} opacity={Math.min(1, level)} />
          </sprite>
        )}
      </group>
    </>
  );
}

let glow: THREE.Texture | null = null;
function glowTexture() {
  if (glow) return glow;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.3, "rgba(255,255,255,0.45)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  glow = new THREE.CanvasTexture(c);
  return glow;
}

/* ---------- capacitors ---------- */

function Capacitor(p: PartModelProps & { polarized: boolean }) {
  const pins = pinsOf(p);
  const a = pins["1"];
  const b = pins["2"];
  const { mid, angle, ux, uz } = axis(a, b);
  const charge = Math.min(1, p.reading?.level ?? 0);
  if (p.polarized) {
    const h = 7;
    return (
      <>
        <Leg pin={a} to={[mid[0] + ux * 1, 1.2, mid[2] + uz * 1]} r={0.25} />
        <Leg pin={b} to={[mid[0] - ux * 1, 1.2, mid[2] - uz * 1]} r={0.25} />
        <group position={[mid[0], 1.2 + h / 2, mid[2]]} rotation={[0, -angle, 0]}>
          <mesh castShadow>
            <cylinderGeometry args={[2.6, 2.6, h, 28]} />
            <meshStandardMaterial color="#1f3c8f" roughness={0.45} />
          </mesh>
          <mesh position={[-1.4, 0, 0]} rotation={[0, 0, 0]}>
            <boxGeometry args={[0.2, h * 0.96, 2.2]} />
            <meshStandardMaterial color="#c8d2e8" />
          </mesh>
          <mesh position={[0, h / 2 + 0.05, 0]}>
            <cylinderGeometry args={[2.45, 2.45, 0.12, 28]} />
            <meshStandardMaterial color="#b9bec6" metalness={0.8} roughness={0.3} emissive="#22a3ff" emissiveIntensity={charge * 0.5} />
          </mesh>
        </group>
      </>
    );
  }
  return (
    <>
      <Leg pin={a} to={[mid[0] + ux * 1.27, 2.2, mid[2] + uz * 1.27]} r={0.22} />
      <Leg pin={b} to={[mid[0] - ux * 1.27, 2.2, mid[2] - uz * 1.27]} r={0.22} />
      <group position={[mid[0], 4.2, mid[2]]} rotation={[0, -angle, 0]}>
        <mesh rotation={[Math.PI / 2, 0, 0]} castShadow scale={[1, 0.45, 1]}>
          <cylinderGeometry args={[2.6, 2.6, 2.2, 28]} />
          <meshStandardMaterial color="#d9892e" roughness={0.6} emissive="#22a3ff" emissiveIntensity={charge * 0.35} />
        </mesh>
      </group>
    </>
  );
}

/* ---------- battery ---------- */

function Battery(p: PartModelProps) {
  const pins = pinsOf(p);
  const plus = pins["1"];
  const minus = pins["2"];
  const { mid, angle } = axis(plus, minus);
  const onDesk = p.part.elev !== undefined; // beside a breadboard: its terminals are where its leads start
  const volts = parseValue(p.value) ?? 9;
  const nine = volts > 6 || onDesk;
  const size: V3 = nine ? [7, 10, 4.5] : [5.5, 8, 5.5];
  const top = size[1] + 0.5;
  const along = (d: number): V3 => [mid[0] + Math.cos(angle) * d, top + 0.8, mid[2] + Math.sin(angle) * d];
  const plusAt = along(-2);
  const minusAt = along(2);
  return (
    <>
      <group position={[mid[0], 0.5 + size[1] / 2, mid[2]]} rotation={[0, -angle, 0]}>
        <mesh castShadow>
          <boxGeometry args={[size[0], size[1], size[2]]} />
          <meshStandardMaterial color="#26282c" roughness={0.5} />
        </mesh>
        <mesh position={[0, size[1] * 0.12, size[2] / 2 + 0.01]}>
          <planeGeometry args={[size[0] * 0.92, size[1] * 0.45]} />
          <meshStandardMaterial color="#e2a72e" roughness={0.6} />
        </mesh>
        <mesh position={[0, size[1] * 0.12, -size[2] / 2 - 0.01]} rotation={[0, Math.PI, 0]}>
          <planeGeometry args={[size[0] * 0.92, size[1] * 0.45]} />
          <meshStandardMaterial color="#e2a72e" roughness={0.6} />
        </mesh>
      </group>
      <mesh position={plusAt}>
        <cylinderGeometry args={[0.9, 0.9, 1.4, 16]} />
        <meshStandardMaterial color="#d6d9de" metalness={0.9} roughness={0.25} />
      </mesh>
      <mesh position={minusAt}>
        <cylinderGeometry args={[1.2, 1.2, 1.4, 6]} />
        <meshStandardMaterial color="#d6d9de" metalness={0.9} roughness={0.25} />
      </mesh>
      {!onDesk && <Wire3 from={plusAt} to={plus} color="#d93b2b" />}
      {!onDesk && <Wire3 from={minusAt} to={minus} color="#222" />}
      <TextSprite text={`${volts} V`} position={[mid[0], top + 3, mid[2]]} size={1.8} color="#e2a72e" />
    </>
  );
}

/** An Arduino lying on the desk: the board on standoffs, two rows of header sockets on top. */
function ArduinoBoard(p: PartModelProps) {
  const pts = p.part.pins.map((pin) => p.w(pin.at[0], pin.at[1]));
  const rowsZ = [...new Set(pts.map((q) => Math.round(q[2] * 10) / 10))].sort((a, b) => a - b);
  const xs = pts.map((q) => q[0]);
  const x0 = Math.min(...xs) - 6;
  const x1 = Math.max(...xs) + 4;
  const z0 = rowsZ[0] - 3.5;
  const z1 = rowsZ[rowsZ.length - 1] + 3.5;
  const uno = p.part.kind === "arduino_uno";
  const BOARD_TOP = 3.2;
  const HEADER = 8.5;
  return (
    <>
      <mesh position={[(x0 + x1) / 2, 2.4, (z0 + z1) / 2]} castShadow receiveShadow>
        <boxGeometry args={[x1 - x0, 1.6, z1 - z0]} />
        <meshStandardMaterial color="#0d6aa6" roughness={0.55} />
      </mesh>
      {rowsZ.map((z) => {
        const row = pts.filter((q) => Math.abs(q[2] - z) < 0.2);
        const rx0 = Math.min(...row.map((q) => q[0])) - 1.27;
        const rx1 = Math.max(...row.map((q) => q[0])) + 1.27;
        return (
          <group key={z}>
            <mesh position={[(rx0 + rx1) / 2, BOARD_TOP + HEADER / 2, z]} castShadow>
              <boxGeometry args={[rx1 - rx0, HEADER, 2.54]} />
              <meshStandardMaterial color="#1b1b1d" roughness={0.6} />
            </mesh>
            {row.map((q, i) => (
              <mesh key={i} position={[q[0], BOARD_TOP + HEADER + 0.01, q[2]]} rotation={[-Math.PI / 2, 0, 0]}>
                <planeGeometry args={[1, 1]} />
                <meshBasicMaterial color="#000" />
              </mesh>
            ))}
          </group>
        );
      })}
      <mesh position={[(x0 + x1) / 2 + (uno ? 6 : 0), BOARD_TOP + 0.9, (z0 + z1) / 2]} castShadow>
        <boxGeometry args={uno ? [35, 1.8, 7.5] : [7, 1.2, 7]} />
        <meshStandardMaterial color="#141416" roughness={0.4} />
      </mesh>
      <mesh position={[x0 + 3, BOARD_TOP + (uno ? 5.5 : 1.8), (z0 + z1) / 2]} castShadow>
        <boxGeometry args={uno ? [16, 11, 12] : [9, 3.6, 7.5]} />
        <meshStandardMaterial color="#c4c9d1" metalness={0.85} roughness={0.3} />
      </mesh>
      <TextSprite text={uno ? "ARDUINO UNO" : "ARDUINO NANO"} position={[(x0 + x1) / 2, BOARD_TOP + 2.5, (z0 + z1) / 2 + (uno ? 9 : 0)]} size={uno ? 3 : 1.8} color="#e9ecef" />
    </>
  );
}

/** A flexible hook-up wire arcing from a to the board point b. */
export function Wire3({ from, to, color, r = 0.45 }: { from: V3; to: V3; color: string; r?: number }) {
  const geom = useMemo(() => {
    const a = new THREE.Vector3(...from);
    const b = new THREE.Vector3(to[0], 0.4, to[2]);
    const m1 = a.clone().add(new THREE.Vector3(0, 3, 0));
    const m2 = b.clone().add(new THREE.Vector3(0, 4, 0));
    return new THREE.TubeGeometry(new THREE.CubicBezierCurve3(a, m1, m2, b), 24, r, 8, false);
  }, [from, to, r]);
  return (
    <mesh geometry={geom} castShadow>
      <meshStandardMaterial color={color} roughness={0.5} />
    </mesh>
  );
}

/* ---------- push button ---------- */

function Button(p: PartModelProps) {
  const pins = pinsOf(p);
  const a = pins["1"];
  const b = pins["2"];
  const { mid, angle, ux, uz } = axis(a, b);
  const down = p.pressed ? 0.7 : 0;
  return (
    <>
      <Leg pin={a} to={[mid[0] - ux * 3, 0.8, mid[2] - uz * 3]} r={0.28} />
      <Leg pin={b} to={[mid[0] + ux * 3, 0.8, mid[2] + uz * 3]} r={0.28} />
      <group
        position={[mid[0], 0, mid[2]]}
        rotation={[0, -angle, 0]}
        onPointerDown={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          p.onPress(true);
        }}
        onPointerUp={() => p.onPress(false)}
        onPointerOut={() => p.pressed && p.onPress(false)}
      >
        <mesh position={[0, 1.8, 0]} castShadow>
          <boxGeometry args={[6.2, 3.6, 6.2]} />
          <meshStandardMaterial color="#1e1f22" roughness={0.6} />
        </mesh>
        <mesh position={[0, 3.6 + 0.2, 0]}>
          <boxGeometry args={[6.4, 0.4, 6.4]} />
          <meshStandardMaterial color="#c9ced6" metalness={0.8} roughness={0.3} />
        </mesh>
        <mesh position={[0, 4.6 - down, 0]} castShadow>
          <cylinderGeometry args={[1.8, 1.9, 1.8, 24]} />
          <meshStandardMaterial color={p.pressed ? "#e0473a" : "#d9493c"} roughness={0.45} emissive="#ff3b2b" emissiveIntensity={p.pressed ? 0.35 : 0} />
        </mesh>
      </group>
    </>
  );
}

/* ---------- potentiometer ---------- */

function Pot(p: PartModelProps) {
  const pins = pinsOf(p);
  const pts = ["1", "2", "3"].map((n) => pins[n]).filter(Boolean);
  const cx = pts.reduce((s, q) => s + q[0], 0) / pts.length;
  const cz = pts.reduce((s, q) => s + q[2], 0) / pts.length;
  const turn = (-135 + 270 * p.wiper) * (Math.PI / 180);
  return (
    <>
      {pts.map((q, i) => (
        <Leg key={i} pin={q} to={[cx + (q[0] - cx) * 0.25, 1, cz + (q[2] - cz) * 0.25]} r={0.28} />
      ))}
      <group position={[cx, 0, cz]}>
        <mesh position={[0, 2.8, 0]} castShadow>
          <boxGeometry args={[9.5, 4.6, 9.5]} />
          <meshStandardMaterial color="#2a5bd7" roughness={0.5} />
        </mesh>
        <group position={[0, 5.1, 0]} rotation={[0, -turn, 0]}>
          <mesh castShadow>
            <cylinderGeometry args={[3, 3, 1.6, 28]} />
            <meshStandardMaterial color="#f2f2ee" roughness={0.4} />
          </mesh>
          <mesh position={[0, 0.82, -1.6]}>
            <boxGeometry args={[0.5, 0.1, 2.6]} />
            <meshStandardMaterial color="#222" />
          </mesh>
        </group>
      </group>
    </>
  );
}

/* ---------- transistor (TO-92) ---------- */

function ToNinetyTwo(p: PartModelProps) {
  const pins = pinsOf(p);
  const pts = Object.values(pins);
  const cx = pts.reduce((s, q) => s + q[0], 0) / pts.length;
  const cz = pts.reduce((s, q) => s + q[2], 0) / pts.length;
  const on = Math.min(1, p.reading?.level ?? 0);
  return (
    <>
      {pts.map((q, i) => (
        <Leg key={i} pin={q} to={[cx + (i - 1) * 1.27, 4, cz]} r={0.22} />
      ))}
      <mesh position={[cx, 6.6, cz]} castShadow>
        <cylinderGeometry args={[2.4, 2.4, 5, 24, 1, false, 0, Math.PI]} />
        <meshStandardMaterial color="#1b1b1d" roughness={0.5} side={THREE.DoubleSide} emissive="#ffb020" emissiveIntensity={on * 0.15} />
      </mesh>
      <mesh position={[cx, 6.6, cz]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[4.8, 5]} />
        <meshStandardMaterial color="#232326" roughness={0.6} side={THREE.DoubleSide} />
      </mesh>
    </>
  );
}

/* ---------- chips, boards, connectors ---------- */

function Chip({ p, color = "#1c1c1f", height = 3.4, lift = 1.2, label, board }: { p: PartModelProps; color?: string; height?: number; lift?: number; label?: string; board?: boolean }) {
  const pins = p.part.pins.map((pin) => ({ pin, at: p.w(pin.at[0], pin.at[1]), inner: p.w(pin.inner[0], pin.inner[1]) }));
  const [x0, y0, x1, y1] = p.part.bbox;
  const a = p.w(x0, y0);
  const b = p.w(x1, y1);
  // The body covers the symbol's body (inside the pin ends).
  const inner = pins.length ? pins.map((q) => q.inner) : [a, b];
  const ix0 = Math.min(...inner.map((q) => q[0]));
  const ix1 = Math.max(...inner.map((q) => q[0]));
  const iz0 = Math.min(...inner.map((q) => q[2]));
  const iz1 = Math.max(...inner.map((q) => q[2]));
  const w = Math.max(6, ix1 - ix0);
  const d = Math.max(6, iz1 - iz0);
  const cx = (ix0 + ix1) / 2;
  const cz = (iz0 + iz1) / 2;
  return (
    <>
      {pins.map(({ pin, at }) => {
        const tx = Math.max(cx - w / 2, Math.min(cx + w / 2, at[0]));
        const tz = Math.max(cz - d / 2, Math.min(cz + d / 2, at[2]));
        return <Leg key={pin.number} pin={at} to={[tx, lift + 0.4, tz]} r={0.22} color={board ? "#d8b24a" : undefined} />;
      })}
      <mesh position={[cx, lift + height / 2, cz]} castShadow>
        <boxGeometry args={[w, height, d]} />
        <meshStandardMaterial color={color} roughness={board ? 0.5 : 0.45} />
      </mesh>
      {board && (
        <>
          <mesh position={[cx, lift + height + 1.5, cz]} castShadow>
            <boxGeometry args={[Math.min(w * 0.4, 14), 2.4, Math.min(d * 0.18, 8)]} />
            <meshStandardMaterial color="#141416" roughness={0.4} />
          </mesh>
          <mesh position={[cx - w / 2 + 3, lift + height + 2, cz - d / 2 + 6]} castShadow>
            <boxGeometry args={[7, 4, 9]} />
            <meshStandardMaterial color="#c4c9d1" metalness={0.85} roughness={0.3} />
          </mesh>
        </>
      )}
      {label && <TextSprite text={label} position={[cx, lift + height + (board ? 4.5 : 0.8), cz]} size={board ? 2.6 : 1.6} color="#e9ecef" />}
    </>
  );
}

function Header(p: PartModelProps) {
  const pins = p.part.pins.map((pin) => p.w(pin.at[0], pin.at[1]));
  return (
    <>
      {pins.map((q, i) => (
        <group key={i} position={[q[0], 0, q[2]]}>
          <mesh position={[0, 1.25, 0]} castShadow>
            <boxGeometry args={[2.54, 2.5, 2.54]} />
            <meshStandardMaterial color="#202124" roughness={0.6} />
          </mesh>
          <mesh position={[0, 4, 0]}>
            <boxGeometry args={[0.64, 6, 0.64]} />
            <meshStandardMaterial color="#d8b24a" metalness={0.9} roughness={0.25} />
          </mesh>
        </group>
      ))}
    </>
  );
}

function Buzzer(p: PartModelProps) {
  const pins = pinsOf(p);
  const pts = Object.values(pins);
  const cx = pts.reduce((s, q) => s + q[0], 0) / pts.length + 3;
  const cz = pts.reduce((s, q) => s + q[2], 0) / pts.length;
  const ref = useRef<THREE.Mesh>(null);
  const level = p.reading?.level ?? 0;
  useFrame(({ clock }) => {
    if (ref.current) ref.current.scale.y = 1 + (level > 0.2 ? Math.sin(clock.elapsedTime * 60) * 0.03 : 0);
  });
  return (
    <>
      {pts.map((q, i) => (
        <Leg key={i} pin={q} to={[cx + (i ? 1.9 : -1.9), 1, cz]} r={0.25} />
      ))}
      <mesh ref={ref} position={[cx, 4.5, cz]} castShadow>
        <cylinderGeometry args={[6, 6, 7.5, 32]} />
        <meshStandardMaterial color="#1b1c1e" roughness={0.5} />
      </mesh>
      <mesh position={[cx, 8.3, cz]}>
        <cylinderGeometry args={[1, 1, 0.2, 16]} />
        <meshStandardMaterial color="#000" />
      </mesh>
    </>
  );
}

const REG_LABEL: Record<string, string> = { regulator_7805: "7805", regulator_ams1117_3v3: "AMS1117" };

export function PartModel(props: PartModelProps) {
  const { part, value } = props;
  switch (part.kind) {
    case "resistor":
      return <Axial p={props} body="#d8c191" bands={resistorBands(parseValue(value) ?? 1000).colors} radius={1.15} />;
    case "diode":
      return <Axial p={props} body="#1d1d20" stripeAt="1" radius={1.25} />;
    case "led":
      return <Led {...props} />;
    case "capacitor":
      return <Capacitor {...props} polarized={false} />;
    case "capacitor_polarized":
      return <Capacitor {...props} polarized />;
    case "battery":
      return <Battery {...props} />;
    case "push_button":
      return <Button {...props} />;
    case "potentiometer":
      return <Pot {...props} />;
    case "npn_transistor":
      return <ToNinetyTwo {...props} />;
    case "buzzer":
      return <Buzzer {...props} />;
    case "connector_2pin":
    case "connector_3pin":
      return <Header {...props} />;
    case "arduino_uno":
    case "arduino_nano":
      return <ArduinoBoard {...props} />;
    case "regulator_7805":
    case "regulator_ams1117_3v3":
      return <Chip p={props} height={4} label={REG_LABEL[part.kind]} />;
    case "timer_555":
      return <Chip p={props} label="NE555" />;
    case "shift_register_74hc595":
      return <Chip p={props} label="74HC595" />;
    default:
      return <Chip p={props} color="#555" />;
  }
}

/* ---------- text ---------- */

const textCache = new Map<string, THREE.Texture>();
function textTexture(text: string, color: string): { tex: THREE.Texture; aspect: number } {
  const key = `${text}|${color}`;
  const c = document.createElement("canvas");
  const g = c.getContext("2d")!;
  const font = "600 44px -apple-system, Segoe UI, sans-serif";
  g.font = font;
  const width = Math.ceil(g.measureText(text).width) + 24;
  if (!textCache.has(key)) {
    c.width = width;
    c.height = 64;
    g.font = font;
    g.fillStyle = color;
    g.textBaseline = "middle";
    g.fillText(text, 12, 34);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    textCache.set(key, tex);
  }
  return { tex: textCache.get(key)!, aspect: width / 64 };
}

export function TextSprite({ text, position, size = 2, color = "#1f1f1f" }: { text: string; position: V3; size?: number; color?: string }) {
  const { tex, aspect } = useMemo(() => textTexture(text, color), [text, color]);
  return (
    <sprite position={position} scale={[size * aspect, size, 1]} renderOrder={10}>
      <spriteMaterial map={tex} transparent depthWrite={false} />
    </sprite>
  );
}

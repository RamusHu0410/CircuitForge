/**
 * Bots to race when nobody else is around. Each is paced from the challenge's par time (what a strong
 * player manages) with some randomness: they think, place parts in bursts, wire, and sometimes submit
 * a build that fails and have to fix it.
 */

import type { Challenge } from "./challenges";

export interface Bot {
  id: string;
  name: string;
  title: string;
  /** Finish time as a multiple of par. */
  factor: number;
  /** Chance a submission fails and costs time. */
  slips: number;
}

export const BOTS: Bot[] = [
  { id: "sparky", name: "Sparky", title: "beginner", factor: 2.3, slips: 0.45 },
  { id: "ohm", name: "Ohm", title: "intermediate", factor: 1.45, slips: 0.25 },
  { id: "tesla", name: "Tesla", title: "elite", factor: 0.95, slips: 0.12 },
  { id: "kirchhoff", name: "Kirchhoff", title: "legend", factor: 0.72, slips: 0.05 },
];

export interface BotRun {
  bot: Bot;
  /** Seconds after the start the bot finishes. */
  finishAt: number;
  attempts: number;
  /** 0..1 at `t` seconds. */
  progress: (t: number) => number;
}

/** A small seeded random generator, so a race replays the same way. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

export function planBot(bot: Bot, challenge: Challenge, seed: number): BotRun {
  const r = rng(seed ^ bot.id.length * 2654435761);
  const base = challenge.par * bot.factor * (0.85 + r() * 0.3);
  let attempts = 1;
  let extra = 0;
  while (r() < bot.slips && attempts < 4) {
    attempts++;
    extra += challenge.par * (0.15 + r() * 0.25);
  }
  const finishAt = base + extra;
  // Phases: think (8–15%), place parts (to ~55%), wire (to ~95%), check and fix (the rest).
  const think = 0.08 + r() * 0.07;
  const placed = 0.45 + r() * 0.15;
  const wired = 0.85 + r() * 0.08;
  const progress = (t: number) => {
    const f = Math.min(1, Math.max(0, t / finishAt));
    if (f >= 1) return 1;
    if (f < think) return 0.02 * (f / think);
    if (f < placed) return 0.02 + 0.48 * ((f - think) / (placed - think)) ** 0.9;
    if (f < wired) return 0.5 + 0.45 * ((f - placed) / (wired - placed));
    return 0.95;
  };
  return { bot, finishAt, attempts, progress };
}

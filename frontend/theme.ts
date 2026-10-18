import { LOGO_PIXELS } from "./components/Logo";

/** Brand (accent) and background colours the user can pick in Settings. */
export const BRAND_PRESETS = [
  { name: "Sky", value: "#3a9be8" },
  { name: "Ocean", value: "#2563eb" },
  { name: "Teal", value: "#0f9d8f" },
  { name: "Violet", value: "#7c5cff" },
  { name: "Rose", value: "#e0517a" },
  { name: "Amber", value: "#d4930f" },
  { name: "Clay", value: "#d77757" },
];

export const BACKGROUND_PRESETS = [
  { name: "White", value: "#ffffff" },
  { name: "Paper", value: "#faf8f4" },
  { name: "Mist", value: "#f3f6fa" },
  { name: "Mint", value: "#f1f7f4" },
  { name: "Night", value: "#15171c" },
];

export const DEFAULT_BRAND = BRAND_PRESETS[0].value;
export const DEFAULT_BACKGROUND = BACKGROUND_PRESETS[0].value;

const HEX = /^#[0-9a-f]{6}$/i;
export const isHex = (v: unknown): v is string => typeof v === "string" && HEX.test(v);

/** Relative luminance (0 = black, 1 = white). */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export const isDark = (background: string) => luminance(background) < 0.25;

function favicon(brand: string): string {
  const d = LOGO_PIXELS.flatMap((row, y) => [...row].flatMap((c, x) => (c === "X" ? [`M${x + 1} ${y + 2}h1v1h-1z`] : []))).join("");
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12' shape-rendering='crispEdges'><rect width='12' height='12' rx='2' fill='#fff'/><path d='${d}' fill='${brand}'/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function applyTheme(brand: string, background: string): void {
  const root = document.documentElement;
  root.style.setProperty("--brand", isHex(brand) ? brand : DEFAULT_BRAND);
  root.style.setProperty("--bg", isHex(background) ? background : DEFAULT_BACKGROUND);
  root.dataset.theme = isDark(background) ? "dark" : "light";
  const link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
  if (link) link.href = favicon(isHex(brand) ? brand : DEFAULT_BRAND);
}

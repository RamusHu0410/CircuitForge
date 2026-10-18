/** KiCad plots onto a whole page; zoom an <svg> element's view to what's actually drawn. */
export function cropSvg(svg: SVGSVGElement): { width: number; height: number } {
  const bb = svg.getBBox();
  const pad = Math.max(bb.width, bb.height) * 0.04;
  const width = bb.width + 2 * pad;
  const height = bb.height + 2 * pad;
  svg.setAttribute("viewBox", `${bb.x - pad} ${bb.y - pad} ${width} ${height}`);
  svg.removeAttribute("width");
  svg.removeAttribute("height");
  return { width, height };
}

/** Render KiCad's SVG to a PNG (data URL) on a white background, cropped to the drawing. */
export async function svgToPng(svgText: string, widthPx = 2400): Promise<string> {
  const holder = document.createElement("div");
  holder.style.cssText = "position:fixed;left:-100000px;top:0;visibility:hidden";
  holder.innerHTML = svgText;
  document.body.appendChild(holder);
  try {
    const svg = holder.querySelector("svg");
    if (!svg) throw new Error("no SVG to render");
    const { width, height } = cropSvg(svg);
    const heightPx = Math.round((widthPx * height) / width);
    svg.setAttribute("width", String(widthPx));
    svg.setAttribute("height", String(heightPx));
    const xml = new XMLSerializer().serializeToString(svg);
    const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml" }));
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = widthPx;
      canvas.height = heightPx;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, widthPx, heightPx);
      ctx.drawImage(img, 0, 0, widthPx, heightPx);
      return canvas.toDataURL("image/png");
    } finally {
      URL.revokeObjectURL(url);
    }
  } finally {
    holder.remove();
  }
}
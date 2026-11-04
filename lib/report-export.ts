export function safeFilePart(value: string) {
  return value.replace(/[^a-zA-Z0-9À-ỹ-]+/g, "-").replace(/^-+|-+$/g, "");
}

export function triggerDownload(href: string, filename: string) {
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function waitForPaint() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

import { settleChartAnimations } from "@/hooks/use-chart-motion";

// html-to-image copies the computed style onto HTML elements only. An SVG shape keeps just its class name, and the
// stylesheet that class came from is not part of the picture, so Tailwind fills (`fill-primary-green-500`) fall back to
// black. Before the picture, the paint of every SVG shape is written inline; afterwards the page is put back.
const SVG_PAINT = [
  "fill",
  "stroke",
  "stroke-width",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-linecap",
  "stroke-linejoin",
  "fill-opacity",
  "stroke-opacity",
  "opacity",
  "mix-blend-mode",
  "visibility",
  "font-family",
  "font-size",
  "font-weight",
  "letter-spacing",
  "text-anchor",
  "dominant-baseline",
];
const SVG_STOP = ["stop-color", "stop-opacity"];
// shapes that are only definitions for other shapes carry no paint of their own (gradient stops are handled apart)
const SVG_SKIP = new Set(["defs", "clippath", "mask", "lineargradient", "radialgradient", "filter", "style", "title", "desc", "stop"]);

function inlineSvgPaint(root: HTMLElement) {
  const restore: (() => void)[] = [];
  const write = (node: SVGElement, properties: string[]) => {
    const computed = getComputedStyle(node);
    const previous = node.getAttribute("style");
    for (const property of properties) node.style.setProperty(property, computed.getPropertyValue(property));
    restore.push(() => (previous === null ? node.removeAttribute("style") : node.setAttribute("style", previous)));
  };
  root.querySelectorAll("svg *").forEach((node) => {
    if (!(node instanceof SVGElement)) return;
    if (node.tagName.toLowerCase() === "stop") write(node, SVG_STOP);
    else if (!SVG_SKIP.has(node.tagName.toLowerCase()) && !node.closest("defs, clipPath, mask")) write(node, SVG_PAINT);
  });
  return () => restore.forEach((undo) => undo());
}

/** Renders a report element to a high-resolution PNG data URL. */
export async function renderReportToPng(element: HTMLElement | null, pixelRatio = 2) {
  if (!element) throw new Error("Không tìm thấy vùng báo cáo.");
  // charts may still be waiting to scroll into view or mid-animation: put them in their final state before the picture
  settleChartAnimations();
  await waitForPaint();
  const restore = inlineSvgPaint(element);
  try {
    const { toPng } = await import("html-to-image");
    return await toPng(element, {
      backgroundColor: "#ffffff",
      cacheBust: true,
      pixelRatio,
      width: element.scrollWidth,
      height: element.scrollHeight,
      style: { margin: "0", transform: "none" },
    });
  } finally {
    restore();
  }
}

type Block = { top: number; bottom: number };

// What a page may not cut through: cards, charts, table rows and anything marked break-inside-avoid.
const UNBREAKABLE = '[data-slot="chart-card"], tr, .break-inside-avoid, [data-pdf-block]';

/** The vertical extent (in the element's own pixels) of every block a page break should not split. */
function collectBlocks(element: HTMLElement): Block[] {
  const box = element.getBoundingClientRect();
  // a report shown scaled down (transform) measures smaller than its own pixels
  const scale = element.offsetWidth > 0 ? box.width / element.offsetWidth : 1;
  return Array.from(element.querySelectorAll<HTMLElement>(UNBREAKABLE), (node) => {
    const rect = node.getBoundingClientRect();
    return { top: (rect.top - box.top) / scale, bottom: (rect.bottom - box.top) / scale };
  }).filter((block) => block.bottom - block.top > 1);
}

/**
 * Where the pages start, from the top of the report to its end. A page ends at the lowest edge between blocks that fits
 * on it; only when a block is taller than a page, or nothing fits, is it cut at the page's full height.
 */
export function planPageCuts(totalHeight: number, pageHeight: number, blocks: Block[]) {
  const keep = blocks.filter((block) => block.bottom - block.top <= pageHeight * 0.95);
  const edges = Array.from(new Set(keep.flatMap((block) => [block.top, block.bottom]))).sort((a, b) => a - b);
  const inside = (y: number) => keep.some((block) => y > block.top + 1 && y < block.bottom - 1);
  const cuts = [0];
  let start = 0;
  while (totalHeight - start > pageHeight + 1) {
    const target = start + pageHeight;
    // a page that would be less than 40% full is worse than a cut through a block
    const fits = edges.filter((y) => y > start + pageHeight * 0.4 && y <= target && !inside(y));
    const cut = fits.length ? Math.max(...fits) : target;
    cuts.push(cut);
    start = cut;
  }
  cuts.push(totalHeight);
  return cuts;
}

/** Renders a report element and saves it as a multi-page landscape PDF, breaking pages between blocks. */
export async function saveReportAsPdf(
  element: HTMLElement | null,
  filename: string,
  { format = "a4", margin = 8 }: { format?: "a4" | "a3"; margin?: number } = {},
) {
  if (!element) throw new Error("Không tìm thấy vùng báo cáo.");
  settleChartAnimations();
  await waitForPaint();
  const blocks = collectBlocks(element);
  const reportWidth = element.scrollWidth;
  const reportHeight = element.scrollHeight;
  const dataUrl = await renderReportToPng(element);
  const [{ jsPDF }, image] = await Promise.all([
    import("jspdf"),
    new Promise<HTMLImageElement>((resolve, reject) => {
      const output = new Image();
      output.onload = () => resolve(output);
      output.onerror = reject;
      output.src = dataUrl;
    }),
  ]);
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format });
  const printableWidth = pdf.internal.pageSize.getWidth() - margin * 2;
  const printableHeight = pdf.internal.pageSize.getHeight() - margin * 2;
  // one page holds this many pixels of the report
  const pageHeight = (printableHeight / printableWidth) * reportWidth;
  const cuts = planPageCuts(reportHeight, pageHeight, blocks);
  const pxPerUnit = image.width / reportWidth;

  for (let page = 0; page < cuts.length - 1; page += 1) {
    const top = Math.round(cuts[page] * pxPerUnit);
    const height = Math.max(1, Math.min(image.height - top, Math.round((cuts[page + 1] - cuts[page]) * pxPerUnit)));
    // each page gets its own slice, so nothing of the next page shows in its bottom margin
    const slice = document.createElement("canvas");
    slice.width = image.width;
    slice.height = height;
    const context = slice.getContext("2d");
    if (!context) throw new Error("Không thể tạo trang PDF.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, slice.width, slice.height);
    context.drawImage(image, 0, top, image.width, height, 0, 0, image.width, height);
    if (page > 0) pdf.addPage(format, "landscape");
    pdf.addImage(slice.toDataURL("image/png"), "PNG", margin, margin, printableWidth, (height * printableWidth) / image.width, undefined, "FAST");
  }
  pdf.save(filename);
}

/** Renders a report element to a PNG Blob, lowering resolution if needed to stay under maxBytes. */
export async function renderReportToBlob(element: HTMLElement | null, maxBytes = 9.5 * 1024 * 1024) {
  for (const pixelRatio of [2, 1.5, 1]) {
    const dataUrl = await renderReportToPng(element, pixelRatio);
    const blob = await (await fetch(dataUrl)).blob();
    if (blob.size <= maxBytes || pixelRatio === 1) return blob;
  }
  throw new Error("Không thể tạo ảnh đủ nhỏ để gửi.");
}

/** Sends a report image to the configured Lark group via our API route. Throws Error with a user-facing message. */
export async function sendReportToLark(element: HTMLElement | null, filename: string) {
  const blob = await renderReportToBlob(element);
  const form = new FormData();
  form.append("image", new File([blob], filename, { type: "image/png" }));
  const response = await fetch("/api/lark/send-image", { method: "POST", body: form });
  const json = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) throw new Error(json?.error ?? "Không thể gửi ảnh tới Lark.");
}

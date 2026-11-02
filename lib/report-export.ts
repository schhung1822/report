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

/** Renders a report element to a high-resolution PNG data URL. */
export async function renderReportToPng(element: HTMLElement | null, pixelRatio = 2) {
  if (!element) throw new Error("Không tìm thấy vùng báo cáo.");
  await waitForPaint();
  const { toPng } = await import("html-to-image");
  return toPng(element, {
    backgroundColor: "#ffffff",
    cacheBust: true,
    pixelRatio,
    width: element.scrollWidth,
    height: element.scrollHeight,
    style: { margin: "0", transform: "none" },
  });
}

/** Renders a report element and saves it as a multi-page landscape PDF. */
export async function saveReportAsPdf(
  element: HTMLElement | null,
  filename: string,
  { format = "a4", margin = 8 }: { format?: "a4" | "a3"; margin?: number } = {},
) {
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
  const renderedHeight = (image.height * printableWidth) / image.width;
  const pages = Math.max(1, Math.ceil(renderedHeight / printableHeight));

  for (let page = 0; page < pages; page += 1) {
    if (page > 0) pdf.addPage(format, "landscape");
    pdf.addImage(dataUrl, "PNG", margin, margin - page * printableHeight, printableWidth, renderedHeight, undefined, "FAST");
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

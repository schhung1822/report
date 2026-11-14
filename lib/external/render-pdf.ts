// Server-only: renders a report to PDF by opening the app's own print page (/print/report) in a headless Chrome.
// The PDF itself is made inside that page by the same code as the "Tải PDF" button, so it looks the same.
import { existsSync } from "node:fs";
import puppeteer, { type Browser } from "puppeteer-core";
import { getAuthConfig } from "@/lib/auth";
import { EXTERNAL_PDF_FORMAT, type ExternalReportKey, type PrintPayload } from "@/lib/external/print-payload";
import { SESSION_COOKIE, signSession } from "@/lib/session-token";

const PAGE_TIMEOUT_MS = 180_000;

export class RenderError extends Error {}

const CHROME_CANDIDATES = [
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/snap/bin/chromium",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

function findChrome() {
  const configured = process.env.CHROME_PATH?.trim();
  if (configured) {
    if (!existsSync(configured)) throw new RenderError(`CHROME_PATH trỏ tới file không tồn tại: ${configured}`);
    return configured;
  }
  const found = CHROME_CANDIDATES.find((path) => existsSync(path));
  if (!found) throw new RenderError("Không tìm thấy Chrome/Chromium trên máy chủ. Hãy cài Chrome hoặc đặt CHROME_PATH trong file .env.");
  return found;
}

/** The address Chrome uses to reach this very server (not the public one: no proxy, no TLS in between). */
function internalBaseUrl() {
  const configured = process.env.INTERNAL_BASE_URL?.trim();
  return (configured || `http://127.0.0.1:${process.env.PORT || 3000}`).replace(/\/+$/, "");
}

/** A session cookie the headless browser can sign in with, signed like the one the login page gives. */
async function browserSession() {
  const config = getAuthConfig();
  if (!config) throw new RenderError("Chưa cấu hình đăng nhập (AUTH_USERNAME / AUTH_PASSWORD / AUTH_SECRET) nên không dựng được báo cáo.");
  return signSession(config.username, config.secret);
}

/** Opens one Chrome for several reports. Always call close() when done. */
export async function openRenderer() {
  const baseUrl = internalBaseUrl();
  const sessionToken = await browserSession();
  let browser: Browser;
  try {
    browser = await puppeteer.launch({
      executablePath: findChrome(),
      headless: true,
      // A server often runs as root and has a small /dev/shm; both make Chrome refuse to start or crash without these.
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });
  } catch (error) {
    if (error instanceof RenderError) throw error;
    throw new RenderError(`Không khởi động được Chrome: ${error instanceof Error ? error.message : "lỗi không xác định"}`);
  }

  return {
    /** Returns the report as a PDF plus any problem noticed while drawing it. */
    async render(key: ExternalReportKey, payload: PrintPayload): Promise<{ pdf: Buffer; warnings: string[] }> {
      const page = await browser.newPage();
      try {
        page.setDefaultTimeout(PAGE_TIMEOUT_MS);
        // Chrome shares its cache between pages: a revalidated page would answer 304, which is not "ok" below.
        await page.setCacheEnabled(false);
        await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
        await page.setCookie({ name: SESSION_COOKIE, value: sessionToken, url: baseUrl, httpOnly: true });
        await page.evaluateOnNewDocument((data) => {
          window.__REPORT_PAYLOAD__ = data;
        }, payload);

        const response = await page.goto(`${baseUrl}/print/report`, { waitUntil: "load", timeout: PAGE_TIMEOUT_MS });
        if (!response?.ok()) throw new RenderError(`Trang in báo cáo trả về lỗi ${response?.status() ?? "không rõ"}.`);

        // Ready = the report is drawn and the cumulative reconciliation (fetched by the page) is no longer loading.
        // (or the page reports an error, which ends the wait at once)
        await page
          .waitForFunction(
            () =>
              Boolean(document.querySelector("[data-print-error]")) ||
              (Boolean(window.__reportReady) && !document.body.innerText.includes("Đang đối soát")),
            { timeout: PAGE_TIMEOUT_MS },
          )
          .catch(() => {
            throw new RenderError("Báo cáo không dựng xong trong thời gian cho phép.");
          });
        const pageError = await page.$eval("[data-print-error]", (node) => node.textContent ?? "").catch(() => null);
        if (pageError !== null) throw new RenderError(pageError || "Không dựng được báo cáo.");

        const warnings = (await page.evaluate(() => document.body.innerText.includes("Không đối soát được"))) ? ["Phần đối soát lũy kế không lấy được dữ liệu từ Pancake POS."] : [];
        const base64 = await page.evaluate((format) => window.__makePdf!(format), EXTERNAL_PDF_FORMAT[key]);
        return { pdf: Buffer.from(base64, "base64"), warnings };
      } finally {
        await page.close().catch(() => {});
      }
    },
    close: () => browser.close().catch(() => {}),
  };
}

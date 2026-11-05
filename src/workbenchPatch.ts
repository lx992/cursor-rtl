import { createHash } from "crypto";

export const MARKER = "<!-- cursor-rtl -->";
export const WORKBENCH_SCRIPT = '<script src="./workbench.js" type="module"></script>';
export const CHECKSUM_KEY = "vs/code/electron-sandbox/workbench/workbench.html";

const INJECTION = [
  MARKER,
  '\t<link rel="stylesheet" href="./cursor-rtl.css">',
  '\t<script src="./cursor-rtl.js"></script>',
].join("\n");

export function injectWorkbenchHtml(html: string): string {
  if (html.includes(MARKER)) {
    return html;
  }
  const index = html.indexOf(WORKBENCH_SCRIPT);
  if (index < 0) {
    throw new Error("تگ workbench.js در workbench.html پیدا نشد.");
  }
  const insertAt = index + WORKBENCH_SCRIPT.length;
  return `${html.slice(0, insertAt)}\n\t${INJECTION}${html.slice(insertAt)}`;
}

export function stripWorkbenchHtml(html: string): string {
  return html.replace(
    /\r?\n\t?<!-- cursor-rtl -->[\s\S]*?<script src="\.\/cursor-rtl\.js"><\/script>/,
    "",
  );
}

export function sha256Base64(contents: Buffer | string): string {
  return createHash("sha256").update(contents).digest("base64").replace(/=+$/g, "");
}

export function updateProductChecksum(productJson: string, checksum: string): string {
  const key = CHECKSUM_KEY.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`("${key}"\\s*:\\s*")[^"]*(")`);
  if (!pattern.test(productJson)) {
    throw new Error("کلید checksum فایل workbench.html در product.json پیدا نشد.");
  }
  return productJson.replace(pattern, `$1${checksum}$2`);
}

export interface RtlConfig {
  enabled: boolean;
  markdownRtl: boolean;
  markdownFont: boolean;
  fontFamily: string;
  fontStack: string;
  revision: string;
}

export function configDocument(
  enabled: boolean,
  fontFamily: string,
  fontStack: string,
  markdownRtl: boolean,
  markdownFont: boolean,
): RtlConfig {
  return {
    enabled,
    markdownRtl,
    markdownFont,
    fontFamily,
    fontStack,
    revision: `${enabled ? "on" : "off"}:${markdownRtl ? "rtl" : "ltr"}:${markdownFont ? "font" : "nofont"}:${fontStack}`,
  };
}

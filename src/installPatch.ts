import { spawn } from "child_process";
import { existsSync } from "fs";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { BUNDLED_FONTS, cssFontStack } from "./fonts";
import { buildCss } from "./stylesheet";
import {
  MARKER,
  configDocument,
  injectWorkbenchHtml,
  sha256Base64,
  stripWorkbenchHtml,
  updateProductChecksum,
} from "./workbenchPatch";

const HTML_SEGMENTS = [
  "resources",
  "app",
  "out",
  "vs",
  "code",
  "electron-sandbox",
  "workbench",
  "workbench.html",
];
const PRODUCT_SEGMENTS = ["resources", "app", "product.json"];

export function workbenchHtmlPath(installRoot: string): string {
  return path.join(installRoot, ...HTML_SEGMENTS);
}

export function productJsonPath(installRoot: string): string {
  return path.join(installRoot, ...PRODUCT_SEGMENTS);
}

export function workbenchDir(installRoot: string): string {
  return path.dirname(workbenchHtmlPath(installRoot));
}

export function findCursorInstallRoot(execPath = process.execPath): string | undefined {
  const candidates = [
    path.dirname(execPath),
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "cursor") : "",
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Programs", "cursor") : "",
    process.env["ProgramFiles(x86)"] ? path.join(process.env["ProgramFiles(x86)"], "cursor") : "",
  ].filter((candidate) => candidate.length > 0);

  for (const candidate of candidates) {
    if (existsSync(workbenchHtmlPath(candidate))) {
      return candidate;
    }
  }
  return undefined;
}

export interface ApplyOptions {
  extensionPath: string;
  installRoot: string;
  enabled: boolean;
  markdownRtl?: boolean;
  markdownFont?: boolean;
  fontFamily: string;
  log?: (message: string) => void;
  onElevate?: () => void | Promise<void>;
}

export interface ApplyResult {
  installRoot: string;
  htmlChanged: boolean;
  filesWritten: string[];
  elevated: boolean;
  alreadyCurrent: boolean;
}

interface PlannedWrite {
  dest: string;
  contents: Buffer;
}

interface BackupOp {
  dest: string;
  backup: string;
  skipIfMarker: boolean;
}

interface CommitOptions {
  probeDir: string;
  planned: PlannedWrite[];
  backups: BackupOp[];
  deletes: string[];
  grants: string[];
  log: (message: string) => void;
  onElevate?: () => void | Promise<void>;
}

function isDenied(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException)?.code;
  return code === "EPERM" || code === "EACCES";
}

async function sameFile(dest: string, contents: Buffer): Promise<boolean> {
  try {
    const current = await fs.readFile(dest);
    return current.equals(contents);
  } catch {
    return false;
  }
}

async function backupFile(op: BackupOp): Promise<void> {
  if (op.skipIfMarker) {
    const text = await fs.readFile(op.dest, "utf8");
    if (text.includes(MARKER)) {
      return;
    }
  }
  await fs.copyFile(op.dest, op.backup);
}

function runPowerShell(command: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
      { windowsHide: true },
    );
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `powershell exited ${code}`));
    });
  });
}

async function elevate(options: CommitOptions): Promise<void> {
  const stage = await fs.mkdtemp(path.join(os.tmpdir(), "cursor-rtl-"));
  const operations: Array<Record<string, unknown>> = [];

  for (const backup of options.backups) {
    operations.push({
      op: "backup",
      dest: backup.dest,
      backup: backup.backup,
      skipIfMarker: backup.skipIfMarker,
    });
  }

  for (const [index, file] of options.planned.entries()) {
    const src = path.join(stage, "payload", String(index));
    await fs.mkdir(path.dirname(src), { recursive: true });
    await fs.writeFile(src, file.contents);
    operations.push({ op: "copy", src, dest: file.dest });
  }

  for (const target of options.deletes) {
    operations.push({ op: "delete", dest: target });
  }

  for (const target of options.grants) {
    operations.push({
      op: "grant",
      dest: target,
      dir: path.basename(target) === "cursor-rtl-fonts",
    });
  }

  const manifestPath = path.join(stage, "manifest.json");
  const resultPath = path.join(stage, "result.json");
  const scriptPath = path.join(stage, "apply.ps1");
  await fs.writeFile(manifestPath, JSON.stringify({ operations }), "utf8");
  await fs.writeFile(scriptPath, elevatedScript(), "utf8");

  const command = [
    "$ErrorActionPreference = 'Stop'",
    "try {",
    `Start-Process -FilePath powershell.exe -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','${scriptPath.replace(/'/g, "''")}'`,
    "} catch {",
    "Write-Error $_.Exception.Message",
    "exit 2",
    "}",
  ].join("; ");

  options.log("برای نوشتن در پوشهٔ Cursor پنجرهٔ اجازهٔ ویندوز باز می‌شود.");
  try {
    await runPowerShell(command);
  } catch (error) {
    if (!existsSync(resultPath)) {
      throw new Error("اجازهٔ مدیر داده نشد یا پنجرهٔ تأیید بسته شد.");
    }
    options.log(error instanceof Error ? error.message : String(error));
  }

  if (!existsSync(resultPath)) {
    throw new Error("کپی فایل‌های چت انجام نشد.");
  }
  const raw = await fs.readFile(resultPath, "utf8");
  const result = JSON.parse(raw.replace(/^\uFEFF/, "")) as { ok?: boolean; error?: string };
  if (!result.ok) {
    throw new Error(result.error || "کپی فایل‌های چت انجام نشد.");
  }
}

function elevatedScript(): string {
  return `
$ErrorActionPreference = "Stop"
$manifestPath = Join-Path $PSScriptRoot "manifest.json"
$resultPath = Join-Path $PSScriptRoot "result.json"
try {
  $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
  foreach ($op in @($manifest.operations)) {
    if ($op.op -eq "backup") {
      $skip = $false
      if ($op.skipIfMarker) {
        $text = [System.IO.File]::ReadAllText($op.dest)
        if ($text.Contains("<!-- cursor-rtl -->")) { $skip = $true }
      }
      if (-not $skip) {
        Copy-Item -LiteralPath $op.dest -Destination $op.backup -Force
      }
    } elseif ($op.op -eq "copy") {
      $parent = Split-Path -Parent $op.dest
      if (-not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
      }
      Copy-Item -LiteralPath $op.src -Destination $op.dest -Force
    } elseif ($op.op -eq "delete") {
      if (Test-Path -LiteralPath $op.dest) {
        Remove-Item -LiteralPath $op.dest -Force -Recurse
      }
    } elseif ($op.op -eq "grant") {
      if (Test-Path -LiteralPath $op.dest) {
        $user = "$env:USERDOMAIN\\$env:USERNAME"
        if ($op.dir) {
          & icacls $op.dest /grant ($user + ":(OI)(CI)M") | Out-Null
        } else {
          & icacls $op.dest /grant ($user + ":(M)") | Out-Null
        }
      }
    }
  }
  @{ ok = $true } | ConvertTo-Json | Set-Content -LiteralPath $resultPath -Encoding UTF8
} catch {
  @{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json | Set-Content -LiteralPath $resultPath -Encoding UTF8
  exit 1
}
`.trimStart();
}

async function commit(options: CommitOptions): Promise<boolean> {
  if (options.planned.length === 0 && options.deletes.length === 0 && options.backups.length === 0) {
    return false;
  }

  try {
    for (const backup of options.backups) {
      await backupFile(backup);
    }
    for (const file of options.planned) {
      await fs.mkdir(path.dirname(file.dest), { recursive: true });
      await fs.writeFile(file.dest, file.contents);
    }
    for (const target of options.deletes) {
      await fs.rm(target, { recursive: true, force: true });
    }
    return false;
  } catch (error) {
    if (!isDenied(error)) {
      throw error;
    }
  }

  if (options.onElevate) {
    await options.onElevate();
  }
  await elevate(options);
  return true;
}

async function readBundledFonts(extensionPath: string): Promise<PlannedWrite[]> {
  const writes: PlannedWrite[] = [];
  for (const font of BUNDLED_FONTS) {
    const source = path.join(extensionPath, "media", "fonts", font.file);
    try {
      const contents = await fs.readFile(source);
      writes.push({ dest: font.file, contents });
    } catch {
      throw new Error(`فایل فونت پیدا نشد: ${font.file}`);
    }
  }
  return writes;
}

export async function applyChatPatch(options: ApplyOptions): Promise<ApplyResult> {
  const log = options.log ?? (() => undefined);
  const htmlPath = workbenchHtmlPath(options.installRoot);
  const productPath = productJsonPath(options.installRoot);
  const dir = workbenchDir(options.installRoot);
  const currentHtml = await fs.readFile(htmlPath, "utf8");
  const installed = currentHtml.includes(MARKER);
  const markdownRtl = options.markdownRtl ?? false;
  const markdownFont = options.markdownFont ?? false;

  if (!options.enabled && !markdownRtl && !markdownFont && !installed) {
    log("قابلیت خاموش است و وصله‌ای نصب نشده.");
    return {
      installRoot: options.installRoot,
      htmlChanged: false,
      filesWritten: [],
      elevated: false,
      alreadyCurrent: true,
    };
  }

  const fontStack = cssFontStack(options.fontFamily);
  const config = configDocument(options.enabled, options.fontFamily, fontStack, markdownRtl, markdownFont);
  const planned: PlannedWrite[] = [];
  const consider = async (dest: string, contents: Buffer) => {
    if (!(await sameFile(dest, contents))) {
      planned.push({ dest, contents });
    }
  };

  let htmlChanged = false;
  const backups: BackupOp[] = [];
  if (!installed && (options.enabled || markdownRtl || markdownFont)) {
    const nextHtml = injectWorkbenchHtml(currentHtml);
    const htmlBuffer = Buffer.from(nextHtml, "utf8");
    const currentProduct = await fs.readFile(productPath, "utf8");
    const nextProduct = updateProductChecksum(currentProduct, sha256Base64(htmlBuffer));
    htmlChanged = true;
    planned.push({ dest: htmlPath, contents: htmlBuffer });
    planned.push({ dest: productPath, contents: Buffer.from(nextProduct, "utf8") });
    backups.push(
      { dest: htmlPath, backup: `${htmlPath}.cursor-rtl-backup`, skipIfMarker: true },
      { dest: productPath, backup: `${productPath}.cursor-rtl-backup`, skipIfMarker: false },
    );
  }

  await consider(
    path.join(dir, "cursor-rtl.css"),
    Buffer.from(buildCss(options.enabled, fontStack, markdownRtl, markdownFont), "utf8"),
  );
  await consider(path.join(dir, "cursor-rtl.js"), await fs.readFile(path.join(options.extensionPath, "media", "cursor-rtl.js")));
  await consider(path.join(dir, "cursor-rtl-config.json"), Buffer.from(`${JSON.stringify(config, null, 2)}\n`, "utf8"));

  for (const font of await readBundledFonts(options.extensionPath)) {
    await consider(path.join(dir, "cursor-rtl-fonts", font.dest), font.contents);
  }

  if (planned.length === 0) {
    log("فایل‌های چت به‌روز هستند.");
    return {
      installRoot: options.installRoot,
      htmlChanged: false,
      filesWritten: [],
      elevated: false,
      alreadyCurrent: true,
    };
  }

  const grants = [
    path.join(dir, "cursor-rtl.css"),
    path.join(dir, "cursor-rtl.js"),
    path.join(dir, "cursor-rtl-config.json"),
    path.join(dir, "cursor-rtl-fonts"),
  ];
  const elevated = await commit({
    probeDir: dir,
    planned,
    backups,
    deletes: [],
    grants,
    log,
    onElevate: options.onElevate,
  });
  log(htmlChanged ? "وصلهٔ چت نصب شد." : "تنظیم چت نوشته شد.");
  return {
    installRoot: options.installRoot,
    htmlChanged,
    filesWritten: planned.map((file) => file.dest),
    elevated,
    alreadyCurrent: false,
  };
}

export async function removeChatPatch(options: {
  installRoot: string;
  log?: (message: string) => void;
  onElevate?: () => void | Promise<void>;
}): Promise<{ elevated: boolean }> {
  const log = options.log ?? (() => undefined);
  const htmlPath = workbenchHtmlPath(options.installRoot);
  const productPath = productJsonPath(options.installRoot);
  const dir = workbenchDir(options.installRoot);
  const htmlBackup = `${htmlPath}.cursor-rtl-backup`;
  const productBackup = `${productPath}.cursor-rtl-backup`;
  const currentHtml = await fs.readFile(htmlPath);
  const currentProduct = await fs.readFile(productPath);

  let nextHtml = currentHtml;
  let nextProduct = currentProduct;
  if (existsSync(htmlBackup)) {
    nextHtml = await fs.readFile(htmlBackup);
  } else if (currentHtml.toString("utf8").includes(MARKER)) {
    nextHtml = Buffer.from(stripWorkbenchHtml(currentHtml.toString("utf8")), "utf8");
  }
  if (existsSync(productBackup)) {
    nextProduct = await fs.readFile(productBackup);
  } else if (!nextHtml.equals(currentHtml)) {
    const updated = updateProductChecksum(currentProduct.toString("utf8"), sha256Base64(nextHtml));
    nextProduct = Buffer.from(updated, "utf8");
  }

  const planned: PlannedWrite[] = [];
  if (!nextHtml.equals(currentHtml)) {
    planned.push({ dest: htmlPath, contents: nextHtml });
  }
  if (!nextProduct.equals(currentProduct)) {
    planned.push({ dest: productPath, contents: nextProduct });
  }

  const deletes = [
    path.join(dir, "cursor-rtl.css"),
    path.join(dir, "cursor-rtl.js"),
    path.join(dir, "cursor-rtl-config.json"),
    path.join(dir, "cursor-rtl-fonts"),
    htmlBackup,
    productBackup,
  ].filter((target) => existsSync(target));

  const elevated = await commit({
    probeDir: dir,
    planned,
    backups: [],
    deletes,
    grants: [],
    log,
    onElevate: options.onElevate,
  });
  log("وصلهٔ چت برداشته شد.");
  return { elevated };
}

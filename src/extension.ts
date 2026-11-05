import * as vscode from "vscode";
import { cssFontStack, FONT_CHOICES, fontStatusLabel, resolveFontFamily } from "./fonts";
import { applyChatPatch, findCursorInstallRoot, removeChatPatch } from "./installPatch";

const MARKDOWN_FONT_MANAGED = "cursorRtl.markdownFontManaged";
const MARKDOWN_FONT_BACKUP = "cursorRtl.markdownFontBackup";

let statusItem: vscode.StatusBarItem;
let output: vscode.OutputChannel;
let extensionPath = "";
let extensionContext: vscode.ExtensionContext;
let applying: Promise<void> = Promise.resolve();
let suppressApply = false;

export function activate(context: vscode.ExtensionContext): void {
  extensionContext = context;
  extensionPath = context.extensionPath;
  output = vscode.window.createOutputChannel("Cursor RTL");
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
  statusItem.command = "cursorRtl.toggle";
  statusItem.show();
  refreshStatus();

  context.subscriptions.push(
    statusItem,
    output,
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (suppressApply || !event.affectsConfiguration("cursorRtl")) {
        return;
      }
      refreshStatus();
      queueApply("settings");
    }),
    vscode.commands.registerCommand("cursorRtl.toggle", toggle),
    vscode.commands.registerCommand("cursorRtl.selectFont", selectFont),
    vscode.commands.registerCommand("cursorRtl.reapply", () => queueApply("reapply")),
    vscode.commands.registerCommand("cursorRtl.remove", removePatch),
  );

  queueApply("startup");
}

export function deactivate(): void {
  return undefined;
}

function currentSettings(): {
  enabled: boolean;
  markdownRtl: boolean;
  markdownFont: boolean;
  choice: string;
  fontFamily: string;
  fontStack: string;
} {
  const config = vscode.workspace.getConfiguration("cursorRtl");
  const choice = config.get<string>("fontFamily", "Vazirmatn");
  const fontFamily = resolveFontFamily(choice, config.get<string>("customFontFamily", ""));
  const legacy = config.inspect<boolean>("markdown")?.globalValue;
  const rtlUnset = config.inspect<boolean>("markdownRtl")?.globalValue === undefined;
  const fontUnset = config.inspect<boolean>("markdownFont")?.globalValue === undefined;
  return {
    enabled: config.get<boolean>("enabled", true),
    markdownRtl: rtlUnset && typeof legacy === "boolean" ? legacy : config.get<boolean>("markdownRtl", true),
    markdownFont: fontUnset && typeof legacy === "boolean" ? legacy : config.get<boolean>("markdownFont", true),
    choice,
    fontFamily,
    fontStack: cssFontStack(fontFamily),
  };
}

async function migrateMarkdownSettings(): Promise<void> {
  const config = vscode.workspace.getConfiguration("cursorRtl");
  const legacy = config.inspect<boolean>("markdown")?.globalValue;
  if (typeof legacy !== "boolean") {
    return;
  }
  suppressApply = true;
  try {
    if (config.inspect<boolean>("markdownRtl")?.globalValue === undefined) {
      await config.update("markdownRtl", legacy, vscode.ConfigurationTarget.Global);
    }
    if (config.inspect<boolean>("markdownFont")?.globalValue === undefined) {
      await config.update("markdownFont", legacy, vscode.ConfigurationTarget.Global);
    }
    await config.update("markdown", undefined, vscode.ConfigurationTarget.Global);
  } finally {
    suppressApply = false;
  }
}

function markdownSection(): Record<string, unknown> {
  const inspected = vscode.workspace.getConfiguration().inspect<Record<string, unknown>>("[markdown]");
  return { ...(inspected?.globalValue ?? {}) };
}

async function syncMarkdownEditorFont(markdown: boolean, fontStack: string): Promise<void> {
  const config = vscode.workspace.getConfiguration();
  const section = markdownSection();
  if (markdown) {
    if (extensionContext.globalState.get(MARKDOWN_FONT_MANAGED) !== true) {
      const previous = section["editor.fontFamily"];
      await extensionContext.globalState.update(
        MARKDOWN_FONT_BACKUP,
        typeof previous === "string" ? previous : null,
      );
      await extensionContext.globalState.update(MARKDOWN_FONT_MANAGED, true);
    }
    if (section["editor.fontFamily"] === fontStack) {
      return;
    }
    section["editor.fontFamily"] = fontStack;
    await config.update("[markdown]", section, vscode.ConfigurationTarget.Global);
    return;
  }

  if (extensionContext.globalState.get(MARKDOWN_FONT_MANAGED) !== true) {
    return;
  }
  const previous = extensionContext.globalState.get<string | null>(MARKDOWN_FONT_BACKUP);
  if (typeof previous === "string") {
    section["editor.fontFamily"] = previous;
  } else {
    delete section["editor.fontFamily"];
  }
  await config.update(
    "[markdown]",
    Object.keys(section).length > 0 ? section : undefined,
    vscode.ConfigurationTarget.Global,
  );
  await extensionContext.globalState.update(MARKDOWN_FONT_MANAGED, false);
  await extensionContext.globalState.update(MARKDOWN_FONT_BACKUP, undefined);
}

function refreshStatus(): void {
  const current = currentSettings();
  if (!current.enabled) {
    statusItem.text = "RTL: خاموش";
    statusItem.tooltip = "روشن کردن راست‌چین و فونت چت";
    return;
  }
  statusItem.text = `RTL: ${fontStatusLabel(current.choice, current.fontFamily)}`;
  statusItem.tooltip = "خاموش کردن راست‌چین چت";
}

function queueApply(reason: string): Promise<void> {
  applying = applying
    .then(() => runApply(reason))
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      output.appendLine(message);
      void vscode.window.showErrorMessage(`Cursor RTL: ${message}`);
    });
  return applying;
}

async function runApply(reason: string): Promise<void> {
  await migrateMarkdownSettings();
  const current = currentSettings();
  refreshStatus();
  const installRoot = findCursorInstallRoot(process.execPath);
  if (!installRoot) {
    statusItem.text = "RTL: نصب Cursor پیدا نشد";
    if (reason !== "startup") {
      void vscode.window.showWarningMessage("پوشهٔ نصب Cursor پیدا نشد.");
    }
    return;
  }

  const result = await applyChatPatch({
    extensionPath,
    installRoot,
    enabled: current.enabled,
    markdownRtl: current.markdownRtl,
    markdownFont: current.markdownFont,
    fontFamily: current.fontFamily,
    log: (message) => output.appendLine(message),
    onElevate: () => {
      void vscode.window.showInformationMessage("برای نصب فونت چت، اجازهٔ مدیر ویندوز را تأیید کنید.");
    },
  });
  await syncMarkdownEditorFont(current.markdownFont, current.fontStack);

  if (result.htmlChanged) {
    const choice = await vscode.window.showInformationMessage(
      "برای دیده شدن فونت و راست‌چین، Cursor را کامل ببندید و دوباره باز کنید.",
      "بستن Cursor",
    );
    if (choice === "بستن Cursor") {
      await vscode.commands.executeCommand("workbench.action.quit");
    }
    return;
  }

  if (!result.alreadyCurrent && reason !== "startup") {
    const message = current.enabled ? "فونت و راست‌چین چت به‌روز شد." : "راست‌چین چت خاموش شد.";
    void vscode.window.setStatusBarMessage(message, 4000);
  }
}

async function toggle(): Promise<void> {
  const config = vscode.workspace.getConfiguration("cursorRtl");
  const enabled = config.get<boolean>("enabled", true);
  await config.update("enabled", !enabled, vscode.ConfigurationTarget.Global);
}

async function selectFont(): Promise<void> {
  const config = vscode.workspace.getConfiguration("cursorRtl");
  const picked = await vscode.window.showQuickPick(
    FONT_CHOICES.map((font) => ({
      label: font.label,
      description: font.id,
      id: font.id,
    })),
    { placeHolder: "فونت چت را انتخاب کنید" },
  );
  if (!picked) {
    return;
  }
  if (picked.id === "Custom") {
    const name = await vscode.window.showInputBox({
      title: "نام فونت",
      prompt: "نام font-family که روی ویندوز نصب شده است",
      value: config.get<string>("customFontFamily", ""),
    });
    if (!name?.trim()) {
      return;
    }
    await config.update("customFontFamily", name.trim(), vscode.ConfigurationTarget.Global);
  }
  await config.update("fontFamily", picked.id, vscode.ConfigurationTarget.Global);
  if (!config.get<boolean>("enabled", true)) {
    await config.update("enabled", true, vscode.ConfigurationTarget.Global);
  }
}

async function removePatch(): Promise<void> {
  const confirmed = await vscode.window.showWarningMessage(
    "راست‌چین و فونت از چت Cursor برداشته شود؟",
    { modal: true },
    "برداشتن",
  );
  if (confirmed !== "برداشتن") {
    return;
  }

  const installRoot = findCursorInstallRoot(process.execPath);
  if (!installRoot) {
    void vscode.window.showWarningMessage("پوشهٔ نصب Cursor پیدا نشد.");
    return;
  }

  suppressApply = true;
  try {
    await syncMarkdownEditorFont(false, "");
    const config = vscode.workspace.getConfiguration("cursorRtl");
    await config.update("enabled", false, vscode.ConfigurationTarget.Global);
    await config.update("markdownRtl", false, vscode.ConfigurationTarget.Global);
    await config.update("markdownFont", false, vscode.ConfigurationTarget.Global);
    refreshStatus();
    await removeChatPatch({
      installRoot,
      log: (message) => output.appendLine(message),
      onElevate: () => {
        void vscode.window.showInformationMessage("برای برداشتن وصله، اجازهٔ مدیر ویندوز را تأیید کنید.");
      },
    });
  } finally {
    suppressApply = false;
  }

  const choice = await vscode.window.showInformationMessage(
    "وصله برداشته شد. Cursor را یک‌بار کامل ببندید و دوباره باز کنید.",
    "بستن Cursor",
  );
  if (choice === "بستن Cursor") {
    await vscode.commands.executeCommand("workbench.action.quit");
  }
}

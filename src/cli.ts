import * as path from "path";
import { applyChatPatch, findCursorInstallRoot, removeChatPatch } from "./installPatch";

async function main(): Promise<void> {
  const command = process.argv[2] ?? "apply";
  const rootArg = process.argv.find((arg) => arg.startsWith("--root="));
  const installRoot = rootArg ? rootArg.slice("--root=".length) : findCursorInstallRoot();
  if (!installRoot) {
    throw new Error("پوشهٔ نصب Cursor پیدا نشد.");
  }

  const extensionPath = path.resolve(__dirname, "..");
  const log = (message: string) => {
    console.log(message);
  };
  const onElevate = () => {
    console.log("پنجرهٔ اجازهٔ ویندوز را تأیید کنید.");
  };

  if (command === "remove") {
    const result = await removeChatPatch({ installRoot, log, onElevate });
    console.log(JSON.stringify(result));
    return;
  }

  const enabled = !process.argv.includes("--off");
  const markdownRtl = !process.argv.includes("--no-markdown-rtl");
  const markdownFont = !process.argv.includes("--no-markdown-font");
  const fontFlag = process.argv.indexOf("--font");
  const fontFamily = fontFlag >= 0 ? process.argv[fontFlag + 1] : "Vazirmatn";
  if (!fontFamily) {
    throw new Error("نام فونت بعد از --font نیامده است.");
  }
  const result = await applyChatPatch({
    extensionPath,
    installRoot,
    enabled,
    markdownRtl,
    markdownFont,
    fontFamily,
    log,
    onElevate,
  });
  console.log(JSON.stringify(result));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { applyChatPatch, removeChatPatch, workbenchHtmlPath, productJsonPath } = require("../dist/installPatch");
const { buildCss } = require("../dist/stylesheet");
const { resolveFontFamily, cssFontStack } = require("../dist/fonts");
const {
  injectWorkbenchHtml,
  stripWorkbenchHtml,
  sha256Base64,
  updateProductChecksum,
  MARKER,
} = require("../dist/workbenchPatch");

const fixture = [
  "<!DOCTYPE html>",
  "<html>",
  "\t<head>",
  '\t\t<link rel="stylesheet" href="../../../workbench/workbench.desktop.main.css">',
  "\t</head>",
  '\t<body aria-label="">',
  "\t</body>",
  '\t<script src="./workbench.js" type="module"></script>',
  "</html>",
  "",
].join("\n");

function testRoundTrip() {
  const injected = injectWorkbenchHtml(fixture);
  assert.ok(injected.includes(MARKER));
  assert.ok(injected.indexOf('src="./workbench.js"') < injected.indexOf(MARKER));
  assert.strictEqual(injectWorkbenchHtml(injected), injected);
  assert.strictEqual(stripWorkbenchHtml(injected), fixture);

  const crlf = fixture.replace(/\n/g, "\r\n");
  assert.strictEqual(stripWorkbenchHtml(injectWorkbenchHtml(crlf)), crlf);
}

function testChecksumReplace() {
  const product = `{
\t"checksums": {
\t\t"vs/workbench/workbench.desktop.main.js": "aaaa",
\t\t"vs/code/electron-sandbox/workbench/workbench.html": "old-value",
\t\t"vs/code/electron-sandbox/workbench/workbench.js": "bbbb"
\t}
}
`;
  const next = updateProductChecksum(product, "new+value/ok");
  assert.ok(next.includes('"vs/code/electron-sandbox/workbench/workbench.html": "new+value/ok"'));
  assert.ok(next.includes('"vs/workbench/workbench.desktop.main.js": "aaaa"'));
  assert.throws(() => updateProductChecksum("{}", "x"));
}

function testFontHelpers() {
  assert.strictEqual(resolveFontFamily("Vazir", ""), "Vazir");
  assert.strictEqual(resolveFontFamily("Custom", "  My Font  "), "My Font");
  assert.strictEqual(resolveFontFamily("Custom", " "), "Tahoma");
  assert.strictEqual(cssFontStack("Tahoma"), "Tahoma, sans-serif");
  assert.strictEqual(cssFontStack('Va"zir'), '"Vazir", Tahoma, sans-serif');
  const css = buildCss(true, '"Vazirmatn", Tahoma, sans-serif', false, false);
  assert.ok(css.includes("Vazirmatn-wght.woff2"));
  assert.ok(css.includes(".ui-prompt-input-editor__input"));
  assert.ok(css.includes("direction: rtl !important"));
  assert.ok(css.includes(".composer-message-codeblock"));
  assert.ok(css.includes("font-family: codicon !important"));
  assert.ok(!css.includes('data-mode-id="markdown"'));
  const withBoth = buildCss(true, '"Vazirmatn", Tahoma, sans-serif', true, true);
  assert.ok(withBoth.includes('data-mode-id="markdown"'));
  assert.ok(withBoth.includes(".ui-prompt-input-editor__input"));
  const rtlOnly = buildCss(false, '"Vazirmatn", Tahoma, sans-serif', true, false);
  assert.ok(rtlOnly.includes('data-mode-id="markdown"'));
  assert.ok(rtlOnly.includes("direction: rtl !important"));
  assert.ok(!rtlOnly.includes("font-family: var(--cursor-rtl-font)"));
  assert.ok(!rtlOnly.includes(".ui-prompt-input-editor__input"));
  const fontOnly = buildCss(false, '"Vazirmatn", Tahoma, sans-serif', false, true);
  assert.ok(fontOnly.includes('data-mode-id="markdown"'));
  assert.ok(fontOnly.includes("font-family: var(--cursor-rtl-font), Tahoma, sans-serif !important"));
  assert.ok(!fontOnly.includes("direction: rtl"));
  assert.strictEqual(buildCss(false, "Tahoma, sans-serif", false, false), "/* cursor-rtl off */\n");
}

function testInstalledChecksum() {
  const root = process.env.ProgramFiles && path.join(process.env.ProgramFiles, "cursor");
  const htmlPath = root && workbenchHtmlPath(root);
  const productPath = root && productJsonPath(root);
  if (!htmlPath || !productPath || !fs.existsSync(htmlPath) || !fs.existsSync(productPath)) {
    console.log("skip installed checksum: Cursor html not found");
    return;
  }
  const html = fs.readFileSync(htmlPath);
  if (html.includes(MARKER)) {
    console.log("skip installed checksum: patch already present");
    return;
  }
  const product = fs.readFileSync(productPath, "utf8");
  const match = product.match(/"vs\/code\/electron-sandbox\/workbench\/workbench\.html": "([^"]+)"/);
  assert.ok(match, "checksum key missing");
  assert.strictEqual(sha256Base64(html), match[1]);
}

async function testApplyOnCopy() {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "cursor-rtl-test-"));
  const htmlPath = workbenchHtmlPath(root);
  const productPath = productJsonPath(root);
  const originalProduct = `{
\t"checksums": {
\t\t"vs/code/electron-sandbox/workbench/workbench.html": "placeholder"
\t}
}
`;
  await fs.promises.mkdir(path.dirname(htmlPath), { recursive: true });
  await fs.promises.mkdir(path.dirname(productPath), { recursive: true });
  await fs.promises.writeFile(htmlPath, fixture, "utf8");
  await fs.promises.writeFile(productPath, originalProduct, "utf8");
  const extensionPath = path.resolve(__dirname, "..");

  const first = await applyChatPatch({
    extensionPath,
    installRoot: root,
    enabled: true,
    fontFamily: "Vazirmatn",
    log: () => undefined,
  });
  assert.strictEqual(first.htmlChanged, true);
  assert.strictEqual(first.elevated, false);
  const patchedHtml = await fs.promises.readFile(htmlPath);
  assert.ok(patchedHtml.includes(MARKER));
  assert.ok(patchedHtml.includes('src="./workbench.js"'));
  const product = await fs.promises.readFile(productPath, "utf8");
  assert.ok(product.includes(sha256Base64(patchedHtml)));
  assert.strictEqual(
    await fs.promises.readFile(`${htmlPath}.cursor-rtl-backup`, "utf8"),
    fixture,
  );
  const config = JSON.parse(await fs.promises.readFile(path.join(path.dirname(htmlPath), "cursor-rtl-config.json"), "utf8"));
  assert.strictEqual(config.enabled, true);
  assert.strictEqual(config.fontFamily, "Vazirmatn");
  const fontStat = await fs.promises.stat(path.join(path.dirname(htmlPath), "cursor-rtl-fonts", "Vazirmatn-wght.woff2"));
  assert.ok(fontStat.size > 1000);
  const css = await fs.promises.readFile(path.join(path.dirname(htmlPath), "cursor-rtl.css"), "utf8");
  assert.ok(css.includes(".ui-prompt-input-editor__input"));
  assert.strictEqual(config.markdownRtl, false);
  assert.strictEqual(config.markdownFont, false);

  const second = await applyChatPatch({
    extensionPath,
    installRoot: root,
    enabled: true,
    fontFamily: "Vazirmatn",
    log: () => undefined,
  });
  assert.strictEqual(second.alreadyCurrent, true);
  assert.strictEqual(second.htmlChanged, false);

  const disabled = await applyChatPatch({
    extensionPath,
    installRoot: root,
    enabled: false,
    fontFamily: "Shabnam",
    log: () => undefined,
  });
  assert.strictEqual(disabled.htmlChanged, false);
  const disabledConfig = JSON.parse(
    await fs.promises.readFile(path.join(path.dirname(htmlPath), "cursor-rtl-config.json"), "utf8"),
  );
  assert.strictEqual(disabledConfig.enabled, false);
  assert.strictEqual(disabledConfig.fontFamily, "Shabnam");
  const disabledCss = await fs.promises.readFile(path.join(path.dirname(htmlPath), "cursor-rtl.css"), "utf8");
  assert.strictEqual(disabledCss, "/* cursor-rtl off */\n");
  assert.ok((await fs.promises.readFile(htmlPath, "utf8")).includes(MARKER));

  await removeChatPatch({ installRoot: root, log: () => undefined });
  assert.strictEqual(await fs.promises.readFile(htmlPath, "utf8"), fixture);
  assert.strictEqual(await fs.promises.readFile(productPath, "utf8"), originalProduct);
  assert.strictEqual(fs.existsSync(path.join(path.dirname(htmlPath), "cursor-rtl.js")), false);
  assert.strictEqual(fs.existsSync(path.join(path.dirname(htmlPath), "cursor-rtl-fonts")), false);
  assert.strictEqual(fs.existsSync(`${htmlPath}.cursor-rtl-backup`), false);

  const skipped = await applyChatPatch({
    extensionPath,
    installRoot: root,
    enabled: false,
    fontFamily: "Vazirmatn",
    log: () => undefined,
  });
  assert.strictEqual(skipped.alreadyCurrent, true);
  assert.strictEqual(fs.existsSync(path.join(path.dirname(htmlPath), "cursor-rtl.js")), false);

  await fs.promises.rm(root, { recursive: true, force: true });
}

async function main() {
  testRoundTrip();
  testChecksumReplace();
  testFontHelpers();
  testInstalledChecksum();
  await testApplyOnCopy();
  console.log("patch tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

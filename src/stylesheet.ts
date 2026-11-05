import { BUNDLED_FONTS } from "./fonts";

const CHAT_ROOTS = [
  ".ui-prompt-input-editor__input",
  "[data-editor-owns-history=\"true\"]",
  ".ui-prompt-input-tiptap-readonly",
  "[data-agent-transcript-human-bubble]",
  ".composer-messages .ui-markdown",
  ".composer-messages-container .ui-markdown",
  ".virtualized-composer-messages-row-body .ui-markdown",
  "[data-composer-messages] .ui-markdown",
];

function textSelectors(roots: string[]): string {
  return roots.flatMap((root) => [root, `${root} *`]).join(",\n");
}

function codeSelectors(roots: string[]): string {
  return roots
    .flatMap((root) => [
      `${root} pre`,
      `${root} pre *`,
      `${root} code`,
      `${root} code *`,
      `${root} .ui-markdown__inline-code`,
      `${root} .composer-message-codeblock`,
      `${root} .composer-message-codeblock *`,
      `${root} .monaco-editor`,
      `${root} .monaco-editor *`,
    ])
    .join(",\n");
}

function fontFaces(): string {
  return BUNDLED_FONTS.map(
    (font) => `@font-face {
  font-family: "${font.family}";
  src: url("./cursor-rtl-fonts/${font.file}") format("woff2");
  font-weight: ${font.weight};
  font-style: normal;
  font-display: swap;
}`,
  ).join("\n\n");
}

function chatCss(): string {
  return `${textSelectors(CHAT_ROOTS)} {
  direction: rtl !important;
  text-align: start !important;
  font-family: var(--cursor-rtl-font), Tahoma, sans-serif !important;
}

.composer-messages .ui-markdown .ui-markdown__table,
.composer-messages .ui-markdown .ui-markdown__th,
.composer-messages .ui-markdown .ui-markdown__td,
.virtualized-composer-messages-row-body .ui-markdown .ui-markdown__table,
.virtualized-composer-messages-row-body .ui-markdown .ui-markdown__th,
.virtualized-composer-messages-row-body .ui-markdown .ui-markdown__td {
  direction: rtl !important;
  text-align: start !important;
  font-family: var(--cursor-rtl-font), Tahoma, sans-serif !important;
}

.composer-messages .ui-markdown ul,
.composer-messages .ui-markdown ol,
.composer-messages .ui-markdown .ui-markdown__list,
.virtualized-composer-messages-row-body .ui-markdown ul,
.virtualized-composer-messages-row-body .ui-markdown ol,
.virtualized-composer-messages-row-body .ui-markdown .ui-markdown__list {
  padding-inline-start: 1.4em !important;
  padding-inline-end: 0 !important;
}

${codeSelectors(CHAT_ROOTS)} {
  direction: ltr !important;
  text-align: left !important;
  unicode-bidi: isolate !important;
  font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace !important;
}

.ui-prompt-input-editor__input .codicon,
.ui-prompt-input-tiptap-readonly .codicon,
[data-agent-transcript-human-bubble] .codicon,
.composer-messages .codicon,
.virtualized-composer-messages-row-body .codicon {
  font-family: codicon !important;
  direction: ltr !important;
  unicode-bidi: isolate !important;
}

.ui-prompt-input-editor__input [class*="mention-chip"],
.ui-prompt-input-editor__input [class*="command-chip"],
[data-agent-transcript-human-bubble] [class*="mention-chip"],
[data-agent-transcript-human-bubble] [class*="command-chip"] {
  direction: ltr !important;
  unicode-bidi: isolate !important;
}

.ui-prompt-input-editor__input p.is-empty::before,
.ui-prompt-input-editor__input [data-placeholder] {
  direction: rtl;
  text-align: right;
}
`;
}

function markdownCss(markdownRtl: boolean, markdownFont: boolean): string {
  const declarations = [
    markdownRtl ? "direction: rtl !important;" : "",
    markdownRtl ? "text-align: right !important;" : "",
    markdownFont ? "font-family: var(--cursor-rtl-font), Tahoma, sans-serif !important;" : "",
  ].filter((line) => line.length > 0);
  return `.monaco-editor[data-mode-id="markdown"],
.monaco-editor[data-mode-id="markdown"] .view-lines,
.monaco-editor[data-mode-id="markdown"] .view-line,
.monaco-editor[data-mode-id="markdown"] .view-line span {
  ${declarations.join("\n  ")}
}
`;
}

export function buildCss(
  enabled: boolean,
  fontStack: string,
  markdownRtl = false,
  markdownFont = false,
): string {
  if (!enabled && !markdownRtl && !markdownFont) {
    return "/* cursor-rtl off */\n";
  }

  const sections: string[] = [];
  if (enabled || markdownFont) {
    sections.push(fontFaces(), "", `:root {\n  --cursor-rtl-font: ${fontStack};\n}`);
  }
  if (enabled) {
    sections.push("", chatCss().trimEnd());
  }
  if (markdownRtl || markdownFont) {
    sections.push("", markdownCss(markdownRtl, markdownFont).trimEnd());
  }
  return `${sections.join("\n")}\n`;
}

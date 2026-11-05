(() => {
  const CONFIG_URL = "./cursor-rtl-config.json";
  const POLL_MS = 1000;
  const INPUT = ".ui-prompt-input-editor__input, [data-editor-owns-history='true']";
  const USER_BUBBLE = "[data-agent-transcript-human-bubble]";
  const USER_READONLY = ".ui-prompt-input-tiptap-readonly";
  const HUMAN_ROW = "[data-human-row='true']";
  const ASSISTANT = ".ui-markdown";
  const ASSISTANT_SCOPE = ".composer-messages, [data-composer-messages], .virtualized-composer-messages-row-body, .composer-messages-container";
  const MARKDOWN_EDITOR = ".monaco-editor[data-mode-id='markdown']";

  let enabled = true;
  let markdownRtl = true;
  let markdownFont = true;
  let lastConfig = "";
  let scheduled = false;
  let lastFallbackReload = 0;
  const pending = [];

  function fontStack(config) {
    if (config && typeof config.fontStack === "string" && config.fontStack.trim()) {
      return config.fontStack;
    }
    const family = String((config && config.fontFamily) || "Vazirmatn").replace(/["\\<>]/g, "").trim() || "Vazirmatn";
    if (family.toLowerCase() === "tahoma") {
      return "Tahoma, sans-serif";
    }
    return `"${family}", Tahoma, sans-serif`;
  }

  function collectDeep(root, selector) {
    const found = [];
    const seen = new Set();
    const visit = (node) => {
      if (!node || !node.querySelectorAll || seen.has(node)) {
        return;
      }
      seen.add(node);
      if (node.nodeType === 1 && node.matches && node.matches(selector)) {
        found.push(node);
      }
      node.querySelectorAll(selector).forEach((element) => found.push(element));
      node.querySelectorAll("*").forEach((element) => {
        if (element.shadowRoot) {
          visit(element.shadowRoot);
        }
      });
    };
    visit(root);
    return found;
  }

  function setDir(element) {
    element.setAttribute("dir", "rtl");
    element.setAttribute("data-cursor-rtl-dir", "1");
  }

  function mark(element, role) {
    if (element.getAttribute("data-cursor-rtl") !== role) {
      element.setAttribute("data-cursor-rtl", role);
    }
    setDir(element);
    const prose = element.matches(".ProseMirror") ? element : element.querySelector(".ProseMirror");
    if (prose) {
      setDir(prose);
    }
  }

  function clearMarkdownEditors() {
    collectDeep(document, "[data-cursor-rtl-md]").forEach((element) => {
      element.removeAttribute("dir");
      element.removeAttribute("data-cursor-rtl-md");
    });
  }

  function scan(root) {
    if (enabled) {
      collectDeep(root, INPUT).forEach((element) => {
        const inUser = element.closest && element.closest(`${USER_BUBBLE}, ${HUMAN_ROW}`);
        mark(element, inUser ? "user" : "input");
      });
      collectDeep(root, USER_BUBBLE).forEach((element) => mark(element, "user"));
      collectDeep(root, USER_READONLY).forEach((element) => mark(element, "user"));
      collectDeep(root, HUMAN_ROW).forEach((row) => {
        if (!row.querySelector(`${INPUT}, ${USER_BUBBLE}, ${USER_READONLY}`)) {
          mark(row, "user");
        }
      });
      collectDeep(root, ASSISTANT).forEach((element) => {
        if (!element.closest(ASSISTANT_SCOPE)) {
          return;
        }
        if (element.closest(`${USER_BUBBLE}, ${HUMAN_ROW}`)) {
          return;
        }
        mark(element, "assistant");
      });
    }
    if (markdownRtl) {
      collectDeep(root, MARKDOWN_EDITOR).forEach((element) => {
        element.setAttribute("data-cursor-rtl-md", "1");
        setDir(element);
      });
    }
  }

  function clearMarks() {
    collectDeep(document, "[data-cursor-rtl]").forEach((element) => {
      element.removeAttribute("data-cursor-rtl");
    });
    collectDeep(document, "[data-cursor-rtl-dir]").forEach((element) => {
      if (element.getAttribute("data-cursor-rtl-md") === "1" && markdownRtl) {
        return;
      }
      element.removeAttribute("dir");
      element.removeAttribute("data-cursor-rtl-dir");
    });
  }

  function flush() {
    scheduled = false;
    const nodes = pending.splice(0, pending.length);
    if (!enabled && !markdownRtl) {
      return;
    }
    if (nodes.length === 0) {
      scan(document);
      return;
    }
    nodes.forEach((node) => scan(node));
  }

  function queue(node) {
    if ((!enabled && !markdownRtl) || !node || node.nodeType !== 1) {
      return;
    }
    pending.push(node);
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(flush);
    }
  }

  function reloadStylesheet(revision) {
    const link = document.querySelector('link[href*="cursor-rtl.css"]');
    if (!link) {
      return;
    }
    const next = `./cursor-rtl.css?rev=${encodeURIComponent(revision || Date.now())}`;
    if (link.getAttribute("href") !== next) {
      link.setAttribute("href", next);
    }
  }

  function applyConfig(config) {
    const legacy = config && typeof config.markdown === "boolean" ? config.markdown : undefined;
    enabled = !config || config.enabled !== false;
    markdownRtl = config && typeof config.markdownRtl === "boolean" ? config.markdownRtl : legacy !== false;
    markdownFont = config && typeof config.markdownFont === "boolean" ? config.markdownFont : legacy !== false;
    document.documentElement.classList.toggle("cursor-rtl-on", enabled);
    document.documentElement.classList.toggle("cursor-rtl-md", markdownRtl);
    document.documentElement.classList.toggle("cursor-rtl-md-font", markdownFont);
    document.documentElement.style.setProperty("--cursor-rtl-font", fontStack(config));
    if (!enabled) {
      clearMarks();
    }
    if (!markdownRtl) {
      clearMarkdownEditors();
    }
    if (enabled || markdownRtl) {
      scan(document);
    }
  }

  async function poll() {
    try {
      const response = await fetch(`${CONFIG_URL}?t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(String(response.status));
      }
      const text = await response.text();
      if (text === lastConfig) {
        if (enabled || markdownRtl) {
          scan(document);
        }
        return;
      }
      const config = JSON.parse(text);
      lastConfig = text;
      applyConfig(config);
      reloadStylesheet(config.revision);
    } catch (error) {
      if (enabled || markdownRtl) {
        scan(document);
      }
      const now = Date.now();
      if (now - lastFallbackReload > 3000) {
        lastFallbackReload = now;
        reloadStylesheet(String(now));
      }
    }
  }

  const observer = new MutationObserver((records) => {
    records.forEach((record) => {
      record.addedNodes.forEach((node) => queue(node));
    });
  });

  function start() {
    document.documentElement.classList.add("cursor-rtl-on");
    document.documentElement.classList.add("cursor-rtl-md");
    scan(document);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    poll();
    setInterval(poll, POLL_MS);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();

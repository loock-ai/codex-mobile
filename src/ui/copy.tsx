import {
  isValidElement,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AppIcon } from "./app-display";
import { t } from "../i18n";

export async function copyText(text: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 局域网 HTTP 页面可能无法使用 Clipboard API，继续使用兼容回退。
  }

  const textarea = document.createElement("textarea");
  const previousFocus =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  try {
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    return document.execCommand?.("copy") === true;
  } catch {
    return false;
  } finally {
    textarea.remove();
    try {
      previousFocus?.focus({ preventScroll: true });
    } catch {
      previousFocus?.focus();
    }
  }
}

function nodeText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (!(node instanceof Element)) return "";
  if (node.classList.contains("copy-action")) return "";
  if (node.tagName === "BR") return "\n";

  const content = Array.from(node.childNodes).map(nodeText).join("");
  if (node.tagName === "LI") return `${content}\n`;
  if (
    /^(ADDRESS|ARTICLE|ASIDE|BLOCKQUOTE|DIV|H[1-6]|HEADER|HR|MAIN|NAV|OL|P|PRE|SECTION|TABLE|UL)$/
      .test(node.tagName)
  ) {
    return `${content}\n\n`;
  }
  return content;
}

export function renderedPlainText(root: Element) {
  return nodeText(root)
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function visibleAssistantText(root: Element | null) {
  if (!root) return "";
  return Array.from(
    root.querySelectorAll(".assistant-message .markdown-body"),
  )
    .map(renderedPlainText)
    .filter(Boolean)
    .join("\n\n");
}

export function reactNodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) return node.map(reactNodeText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return reactNodeText(node.props.children);
  }
  return "";
}

export function CopyButton({
  text,
  label,
  className = "",
}: {
  text: string | (() => string);
  label: string;
  className?: string;
}) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    },
    [],
  );

  const handleCopy = async () => {
    const value = typeof text === "function" ? text() : text;
    const copied = Boolean(value) && await copyText(value);
    setStatus(copied ? "copied" : "failed");
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    resetTimerRef.current = setTimeout(() => setStatus("idle"), 1400);
  };

  return (
    <span className={`copy-action ${className}`.trim()}>
      <button type="button" aria-label={label} onClick={() => void handleCopy()}>
        {status === "copied" ? (
          <span aria-hidden="true">✓</span>
        ) : status === "failed" ? (
          <span aria-hidden="true">!</span>
        ) : (
          <AppIcon name="copy" />
        )}
      </button>
      {status !== "idle" && (
        <small role="status">
          {status === "copied" ? t("已复制") : t("复制失败")}
        </small>
      )}
    </span>
  );
}

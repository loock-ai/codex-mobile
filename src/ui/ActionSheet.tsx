import {
  useId,
  useEffect,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { t } from "../i18n";

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function ActionSheet({
  open = true,
  title,
  ariaLabel,
  children,
  footer,
  headerActions,
  onClose,
  closeLabel = t("关闭"),
  closeIcon = "×",
  closeDisabled = false,
  closeOnBackdrop = true,
  closeOnEscape = closeOnBackdrop,
  showHandle = false,
  tone = "white",
  titleAlign = "left",
  className = "",
  backdropClassName = "",
}: {
  open?: boolean;
  title: ReactNode;
  ariaLabel?: string;
  children: ReactNode;
  footer?: ReactNode;
  headerActions?: ReactNode;
  onClose?: () => void;
  closeLabel?: string;
  closeIcon?: ReactNode;
  closeDisabled?: boolean;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
  showHandle?: boolean;
  tone?: "white" | "soft";
  titleAlign?: "left" | "center";
  className?: string;
  backdropClassName?: string;
}) {
  const titleId = useId();
  const sheetRef = useRef<HTMLElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const firstFocusable =
      sheetRef.current?.querySelector<HTMLElement>(focusableSelector);
    (firstFocusable ?? sheetRef.current)?.focus();
    return () => {
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
    };
  }, [open]);

  if (!open) return null;
  const closeAction = onClose ? (
      <button
        type="button"
        className="action-sheet-close"
        aria-label={closeLabel}
        disabled={closeDisabled}
        onClick={onClose}
      >
        {closeIcon}
      </button>
    ) : null;
  const actions =
    headerActions || closeAction ? (
      <>
        {headerActions}
        {closeAction}
      </>
    ) : null;

  const stopPropagation = (event: MouseEvent<HTMLElement>) => {
    event.stopPropagation();
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape" && closeOnEscape && onClose) {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      sheetRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [],
    );
    if (!focusable.length) {
      event.preventDefault();
      sheetRef.current?.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className={`action-sheet-backdrop ${backdropClassName}`.trim()}
      role="presentation"
      onClick={closeOnBackdrop && onClose ? () => onClose() : undefined}
    >
      <section
        ref={sheetRef}
        className={`action-sheet action-sheet-${tone} action-sheet-title-${titleAlign}${footer ? " action-sheet-has-footer" : ""} ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabel ? undefined : titleId}
        onClick={stopPropagation}
        onKeyDown={handleKeyDown}
      >
        {showHandle && (
          <i className="action-sheet-handle sheet-handle" aria-hidden="true" />
        )}
        <header className="action-sheet-header">
          <div className="action-sheet-title" id={titleId}>
            {typeof title === "string" ? <h2>{title}</h2> : title}
          </div>
          {actions && <div className="action-sheet-actions">{actions}</div>}
        </header>
        <div className="action-sheet-body">{children}</div>
        {footer && <footer className="action-sheet-footer">{footer}</footer>}
      </section>
    </div>
  );
}

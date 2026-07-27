import type { CSSProperties } from "react";
import { AppIcon, titleOf, type DisplayRecord } from "../../ui/app-display";

type AnyRecord = Record<string, any>;

export interface ContextUsageView {
  used: number;
  total: number;
  usedPercent: number;
  remainingPercent: number;
}

export interface RateLimitView {
  remainingPercent: number;
  resetsAt: number | null;
}

export function contextUsageView(
  tokenUsage: AnyRecord | null | undefined,
): ContextUsageView | null {
  // `total` is cumulative usage across the whole thread. The context meter
  // must use the latest request's context footprint (`last`), otherwise long
  // lived sessions immediately appear to be over 100%.
  const used = Number(
    tokenUsage?.last?.totalTokens ?? tokenUsage?.total?.totalTokens,
  );
  const total = Number(tokenUsage?.modelContextWindow);
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) {
    return null;
  }
  const usedPercent = Math.min(100, Math.max(0, (used / total) * 100));
  return {
    used,
    total,
    usedPercent,
    remainingPercent: 100 - usedPercent,
  };
}

export function sevenDayRateLimitView(
  rateLimits: AnyRecord | null | undefined,
): RateLimitView | null {
  const snapshot = rateLimits?.rateLimits ?? rateLimits;
  const candidates = [snapshot?.secondary, snapshot?.primary].filter(Boolean);
  const window = candidates.find(
    (entry) => Number(entry.windowDurationMins) >= 7 * 24 * 60,
  );
  const usedPercent = Number(window?.usedPercent);
  if (!Number.isFinite(usedPercent)) return null;
  return {
    remainingPercent: Math.min(100, Math.max(0, 100 - usedPercent)),
    resetsAt: Number.isFinite(Number(window?.resetsAt))
      ? Number(window.resetsAt)
      : null,
  };
}

function formatCount(value: number) {
  if (value >= 10_000) {
    return `${Math.round(value / 10_000)}万`;
  }
  return new Intl.NumberFormat("zh-CN").format(value);
}

function formatResetTime(timestamp: number | null) {
  if (!timestamp) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp * 1000));
}

export function ContextUsageButton({
  tokenUsage,
  onClick,
}: {
  tokenUsage: AnyRecord | null;
  onClick: () => void;
}) {
  const usage = contextUsageView(tokenUsage);
  const degrees = Math.round((usage?.usedPercent ?? 0) * 3.6);
  return (
    <button
      className="context-usage-button"
      type="button"
      aria-label="查看上下文占用情况"
      onClick={onClick}
      style={{ "--usage-degrees": `${degrees}deg` } as CSSProperties}
    >
      <i />
    </button>
  );
}

export function ConversationStatusSheet({
  open,
  thread,
  tokenUsage,
  rateLimits,
  onClose,
}: {
  open: boolean;
  thread: DisplayRecord;
  tokenUsage: AnyRecord | null;
  rateLimits: AnyRecord | null;
  onClose: () => void;
}) {
  if (!open) return null;
  const usage = contextUsageView(tokenUsage);
  const sevenDay = sevenDayRateLimitView(rateLimits);
  const copyThreadId = () => {
    void navigator.clipboard?.writeText(String(thread.id ?? ""));
  };
  return (
    <div className="conversation-sheet-backdrop" onClick={onClose}>
      <section
        className="conversation-status-sheet"
        aria-modal="true"
        aria-label="状态"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <i className="sheet-handle" aria-hidden="true" />
        <header>
          <h2>状态</h2>
          <button type="button" aria-label="关闭状态" onClick={onClose}>
            <AppIcon name="close" />
          </button>
        </header>
        <dl>
          <div>
            <dt>对话线程：</dt>
            <dd>
              <code>{thread.id || "暂无数据"}</code>
              {!!thread.id && (
                <button
                  type="button"
                  aria-label="复制会话 ID"
                  onClick={copyThreadId}
                >
                  <AppIcon name="copy" />
                </button>
              )}
            </dd>
          </div>
          <div>
            <dt>目录：</dt>
            <dd><code>{thread.cwd || "暂无数据"}</code></dd>
          </div>
          <div>
            <dt>上下文：</dt>
            <dd>
              {usage
                ? `剩余 ${Math.round(usage.remainingPercent)}%（已用 ${formatCount(
                    usage.used,
                  )} / ${formatCount(usage.total)}）`
                : "暂无数据"}
            </dd>
          </div>
          <div>
            <dt>7 天限制：</dt>
            <dd>
              {sevenDay
                ? `剩余 ${Math.round(sevenDay.remainingPercent)}%${
                    sevenDay.resetsAt
                      ? `（将于 ${formatResetTime(sevenDay.resetsAt)} 重置）`
                      : ""
                  }`
                : "暂无数据"}
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}

export function ConversationActionMenu({
  open,
  thread,
  pendingAction,
  onClose,
  onPin,
  onCopy,
  onRename,
  onArchive,
}: {
  open: boolean;
  thread: DisplayRecord;
  pendingAction: string;
  onClose: () => void;
  onPin: () => void;
  onCopy: () => void;
  onRename: () => void;
  onArchive: () => void;
}) {
  if (!open) return null;
  const pinned = thread.isPinned === true;
  const actions = [
    {
      id: "pin",
      label: pinned ? "取消置顶" : "置顶",
      icon: "pin" as const,
      onClick: onPin,
    },
    {
      id: "copy",
      label: "复制会话 ID",
      icon: "copy" as const,
      onClick: onCopy,
    },
    {
      id: "rename",
      label: "重命名",
      icon: "rename" as const,
      onClick: onRename,
    },
    {
      id: "archive",
      label: "归档",
      icon: "archive" as const,
      onClick: onArchive,
      danger: true,
    },
  ];
  return (
    <>
      <button
        className="conversation-action-dismiss"
        type="button"
        aria-label="关闭会话操作"
        onClick={onClose}
      />
      <section className="conversation-action-menu" aria-label="会话操作">
        <p>{titleOf(thread)}</p>
        <div>
          {actions.map((action) => (
            <button
              type="button"
              className={action.danger ? "danger" : ""}
              disabled={!!pendingAction}
              aria-busy={pendingAction === action.id}
              key={action.id}
              onClick={action.onClick}
            >
              <AppIcon name={action.icon} />
              <span>{action.label}</span>
              {pendingAction === action.id && (
                <i className="action-spinner" aria-hidden="true" />
              )}
            </button>
          ))}
        </div>
      </section>
    </>
  );
}

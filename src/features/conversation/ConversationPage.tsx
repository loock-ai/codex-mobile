import {
  type FormEvent,
  type RefObject,
  type UIEventHandler,
  useState,
} from "react";
import { AppServerClient } from "../../app-server/client";
import type { OlderTurnsLoadState } from "../../app-server/thread-session";
import type { BackendConfig } from "../../backends/types";
import {
  MAX_DRAFT_IMAGES,
  MAX_TOTAL_IMAGE_BYTES,
  type DraftImage,
} from "../../ui/attachments";
import {
  AppIcon,
  titleOf,
  type ConnectionState,
  type DisplayRecord,
} from "../../ui/app-display";
import { effortLabel } from "../../ui/settings";
import { groupConversationTurns } from "../../ui/conversation";
import { TurnCard } from "./Timeline";
import {
  ContextUsageButton,
  ConversationActionMenu,
  ConversationStatusSheet,
} from "./ConversationControls";
import { useConversationAutoScroll } from "./conversation-scroll";

export type ConversationLoadState = "idle" | "loading" | "ready" | "error";

export function ConversationPage({
  active,
  backendId,
  backendName,
  backends,
  projectOptions,
  loadState,
  loadError,
  olderTurnsState,
  connection,
  client,
  error,
  draft,
  draftImages,
  imageReading,
  busy,
  tokenUsage,
  rateLimits,
  pendingAction,
  selectedServiceTier,
  selectedModelLabel,
  selectedEffort,
  selectedPermissionLabel,
  imageInputRef,
  onBack,
  onNewChatBackendChange,
  onNewChatProjectChange,
  onPin,
  onRename,
  onArchive,
  onRetry,
  onLoadOlderTurns,
  onSubmit,
  onRemoveImage,
  onSelectImages,
  onOpenAgentSettings,
  onOpenPermissionSettings,
  onDraftChange,
  onInterrupt,
}: {
  active: DisplayRecord;
  backendId: string;
  backendName: string;
  backends: BackendConfig[];
  projectOptions: Array<{ cwd: string; name: string }>;
  loadState: ConversationLoadState;
  loadError: string;
  olderTurnsState: OlderTurnsLoadState;
  connection: ConnectionState;
  client: AppServerClient | null;
  error: string;
  draft: string;
  draftImages: DraftImage[];
  imageReading: boolean;
  busy: boolean;
  tokenUsage: Record<string, any> | null;
  rateLimits: Record<string, any> | null;
  pendingAction: string;
  selectedServiceTier: string | null;
  selectedModelLabel: string;
  selectedEffort: string | null;
  selectedPermissionLabel: string;
  imageInputRef: RefObject<HTMLInputElement | null>;
  onBack: () => void;
  onNewChatBackendChange: (backendId: string) => void;
  onNewChatProjectChange: (cwd: string) => void;
  onPin: () => Promise<boolean>;
  onRename: () => Promise<boolean>;
  onArchive: () => Promise<boolean>;
  onRetry: () => void;
  onLoadOlderTurns: () => Promise<boolean>;
  onSubmit: (event: FormEvent) => void;
  onRemoveImage: (imageId: string) => void;
  onSelectImages: (files: FileList | null) => Promise<void>;
  onOpenAgentSettings: () => void;
  onOpenPermissionSettings: () => void;
  onDraftChange: (value: string) => void;
  onInterrupt: () => void | Promise<void>;
}) {
  const [statusOpen, setStatusOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const turns = groupConversationTurns(active.turns ?? []);
  const isNewChat = !active.id;
  const {
    scrollRef,
    contentRef,
    onScroll,
    scrollToLatest,
    showJumpToLatest,
    beginPrependPreservation,
    cancelPrependPreservation,
  } = useConversationAutoScroll({
    threadId: String(active.id ?? `new:${backendId}`),
    contentRevision: active.turns,
    ready: loadState === "ready",
  });
  const interactive =
    loadState === "ready" && (!isNewChat || !!active.cwd);
  const requestOlderTurns = () => {
    if (!["idle", "error"].includes(olderTurnsState)) return;
    beginPrependPreservation();
    void onLoadOlderTurns().then((loaded) => {
      if (!loaded) cancelPrependPreservation();
    });
  };
  const handleScroll: UIEventHandler<HTMLDivElement> = (event) => {
    onScroll(event);
    if (
      event.currentTarget.scrollTop <= 48 &&
      olderTurnsState === "idle"
    ) {
      requestOlderTurns();
    }
  };
  return (
    <section className="conversation">
      <header className="conversation-header">
        <button
          className="round-button"
          aria-label="打开会话列表"
          onClick={onBack}
        >
          <AppIcon name="menu" />
        </button>
        <div className="thread-heading">
          <strong>{titleOf(active)}</strong>
          <span>
            <i className={`status-dot ${connection}`} />
            {backendName} · {active.cwd?.split("/").pop() || "未选择项目"} ·{" "}
            {connection === "online" ? "已连接" : "连接中"}
          </span>
        </div>
        {!!active.id && (
          <div className="conversation-header-actions">
            <ContextUsageButton
              tokenUsage={tokenUsage}
              onClick={() => {
                setActionsOpen(false);
                setStatusOpen(true);
              }}
            />
            <button
              className="round-button"
              type="button"
              aria-label="会话操作"
              aria-expanded={actionsOpen}
              onClick={() => {
                setStatusOpen(false);
                setActionsOpen((current) => !current);
              }}
            >
              <AppIcon name="more" />
            </button>
          </div>
        )}
      </header>
      <ConversationActionMenu
        open={actionsOpen}
        thread={active}
        pendingAction={pendingAction}
        onClose={() => setActionsOpen(false)}
        onPin={() => {
          void onPin().then((completed) => {
            if (completed) setActionsOpen(false);
          });
        }}
        onCopy={() => {
          void navigator.clipboard?.writeText(String(active.id));
          setActionsOpen(false);
        }}
        onRename={() => {
          void onRename().then((completed) => {
            if (completed) setActionsOpen(false);
          });
        }}
        onArchive={() => {
          void onArchive().then((completed) => {
            if (completed) setActionsOpen(false);
          });
        }}
      />
      <div
        className="conversation-scroll"
        ref={scrollRef}
        onScroll={handleScroll}
      >
        <div className="conversation-scroll-content" ref={contentRef}>
          {isNewChat && (
            <section className="new-chat-targets" aria-label="新聊天目标">
              <h2>开始处理</h2>
              <label>
                <AppIcon name="folder" />
                <span>
                  <small>项目</small>
                  <strong>
                    {projectOptions.find(
                      (project) => project.cwd === active.cwd,
                    )?.name ?? "请选择项目"}
                  </strong>
                </span>
                <select
                  aria-label="选择项目"
                  value={active.cwd ?? ""}
                  disabled={!projectOptions.length}
                  onChange={(event) =>
                    onNewChatProjectChange(event.currentTarget.value)
                  }
                >
                  {!projectOptions.length && (
                    <option value="">没有可用项目</option>
                  )}
                  {projectOptions.map((project) => (
                    <option value={project.cwd} key={project.cwd}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="device-glyph" aria-hidden="true">▰</span>
                <span>
                  <small>机器</small>
                  <strong>{backendName}</strong>
                </span>
                <select
                  aria-label="选择机器"
                  value={backendId}
                  onChange={(event) =>
                    onNewChatBackendChange(event.currentTarget.value)
                  }
                >
                  {backends.map((backend) => (
                    <option value={backend.id} key={backend.id}>
                      {backend.name}
                    </option>
                  ))}
                </select>
              </label>
              {!projectOptions.length && (
                <p role="alert">没有可用项目，暂时无法启动新聊天。</p>
              )}
            </section>
          )}
          <div className="timeline" aria-busy={loadState === "loading"}>
            {loadState === "ready" && olderTurnsState === "idle" && (
              <button
                type="button"
                className="older-turns-control"
                onClick={requestOlderTurns}
              >
                加载更早消息
              </button>
            )}
            {loadState === "ready" && olderTurnsState === "loading" && (
              <div className="older-turns-status" role="status">
                <i className="action-spinner" aria-hidden="true" />
                正在加载更早消息
              </div>
            )}
            {loadState === "ready" && olderTurnsState === "error" && (
              <button
                type="button"
                className="older-turns-control error"
                onClick={requestOlderTurns}
              >
                加载失败，点击重试
              </button>
            )}
            {loadState === "loading" ? (
              <div
                className="conversation-skeleton"
                role="status"
                aria-label="正在加载会话详情"
              >
                {Array.from({ length: 7 }, (_, index) => <i key={index} />)}
              </div>
            ) : loadState === "error" ? (
              <div className="conversation-load-error" role="alert">
                <strong>无法加载会话</strong>
                <p>{loadError || "请检查连接后重试。"}</p>
                <button type="button" onClick={onRetry}>重试</button>
              </div>
            ) : turns.length ? turns.map((turn: DisplayRecord, index: number) => (
              <TurnCard
                key={turn.id ?? index}
                turn={turn}
                liveDiff={turn.liveDiff}
                client={client}
              />
            )) : !isNewChat && (
              <div className="empty-state">开始一次新的 Codex 对话</div>
            )}
          </div>
        </div>
      </div>
      {showJumpToLatest && (
        <button
          type="button"
          className="jump-to-latest"
          aria-label="回到最新消息"
          onClick={scrollToLatest}
        >
          ↓
        </button>
      )}
      {error && <div className="error-banner" role="alert">{error}</div>}
      <form
        className="composer-wrap"
        aria-busy={imageReading}
        onSubmit={onSubmit}
      >
        {draftImages.length > 0 && (
          <div className="draft-images" aria-label="待发送图片">
            {draftImages.map((image) => (
              <figure key={image.id}>
                <img src={image.url} alt={`待发送 ${image.name}`} />
                <button
                  type="button"
                  aria-label={`移除 ${image.name}`}
                  onClick={() => onRemoveImage(image.id)}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </figure>
            ))}
          </div>
        )}
        {imageReading && (
          <div className="draft-image-reading" role="status" aria-live="polite">
            正在读取图片…
          </div>
        )}
        <div className="chips">
          <button
            type="button"
            aria-label="选择模型、智能与速度"
            disabled={!interactive}
            onClick={onOpenAgentSettings}
          >
            {selectedServiceTier ? "⚡ " : ""}
            {selectedModelLabel} {effortLabel(selectedEffort)}
          </button>
          <button
            type="button"
            aria-label="选择审批与权限模式"
            disabled={!interactive}
            onClick={onOpenPermissionSettings}
          >
            {selectedPermissionLabel}
          </button>
        </div>
        <div className="composer">
          <input
            ref={imageInputRef}
            className="visually-hidden"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            aria-label="选择图片"
            onChange={(event) => {
              const input = event.currentTarget;
              void onSelectImages(input.files).finally(() => {
                input.value = "";
              });
            }}
          />
          <button
            type="button"
            className="add-button"
            aria-label="添加附件"
            disabled={
              !interactive ||
              imageReading ||
              draftImages.length >= MAX_DRAFT_IMAGES ||
              draftImages.reduce((total, image) => total + image.size, 0) >=
                MAX_TOTAL_IMAGE_BYTES
            }
            onClick={() => imageInputRef.current?.click()}
          >
            ＋
          </button>
          <textarea
            aria-label="向 Codex 提问"
            value={draft}
            disabled={!interactive}
            onChange={(event) => onDraftChange(event.target.value)}
            placeholder="向 Codex 提问"
            rows={1}
          />
          <button
            type={busy ? "button" : "submit"}
            onClick={busy ? onInterrupt : undefined}
            className="send-button"
            aria-label={busy ? "停止" : "发送"}
            disabled={
              !interactive ||
              (!busy &&
                (imageReading || (!draft.trim() && !draftImages.length)))
            }
          >
            <AppIcon name={busy ? "stop" : "send"} />
          </button>
        </div>
      </form>
      <ConversationStatusSheet
        open={statusOpen}
        thread={active}
        tokenUsage={tokenUsage}
        rateLimits={rateLimits}
        onClose={() => setStatusOpen(false)}
      />
    </section>
  );
}

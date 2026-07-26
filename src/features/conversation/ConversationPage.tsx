import {
  type FormEvent,
  type RefObject,
} from "react";
import { AppServerClient } from "../../app-server/client";
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
import { TurnCard } from "./Timeline";

export function ConversationPage({
  active,
  connection,
  client,
  error,
  draft,
  draftImages,
  imageReading,
  busy,
  selectedServiceTier,
  selectedModelLabel,
  selectedEffort,
  selectedPermissionLabel,
  imageInputRef,
  onBack,
  onSubmit,
  onRemoveImage,
  onSelectImages,
  onOpenAgentSettings,
  onOpenPermissionSettings,
  onDraftChange,
  onInterrupt,
}: {
  active: DisplayRecord;
  connection: ConnectionState;
  client: AppServerClient | null;
  error: string;
  draft: string;
  draftImages: DraftImage[];
  imageReading: boolean;
  busy: boolean;
  selectedServiceTier: string | null;
  selectedModelLabel: string;
  selectedEffort: string | null;
  selectedPermissionLabel: string;
  imageInputRef: RefObject<HTMLInputElement | null>;
  onBack: () => void;
  onSubmit: (event: FormEvent) => void;
  onRemoveImage: (imageId: string) => void;
  onSelectImages: (files: FileList | null) => Promise<void>;
  onOpenAgentSettings: () => void;
  onOpenPermissionSettings: () => void;
  onDraftChange: (value: string) => void;
  onInterrupt: () => void | Promise<void>;
}) {
  const turns = active.turns ?? [];
  return (
    <section className="conversation">
      <header className="conversation-header">
        <button
          className="round-button"
          aria-label="返回"
          onClick={onBack}
        >
          <AppIcon name="back" />
        </button>
        <div className="thread-heading">
          <strong>{titleOf(active)}</strong>
          <span><i className={`status-dot ${connection}`} /> {active.cwd?.split("/").pop() || "Codex"} · {connection === "online" ? "已连接" : "连接中"}</span>
        </div>
        <button className="round-button" aria-label="更多"><AppIcon name="more" /></button>
      </header>
      <div className="timeline">
        {turns.length ? turns.map((turn: DisplayRecord, index: number) => (
          <TurnCard
            key={turn.id ?? index}
            turn={turn}
            liveDiff={turn.liveDiff}
            client={client}
          />
        )) : <div className="empty-state">开始一次新的 Codex 对话</div>}
      </div>
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
            onClick={onOpenAgentSettings}
          >
            {selectedServiceTier ? "⚡ " : ""}
            {selectedModelLabel} {effortLabel(selectedEffort)}
          </button>
          <button
            type="button"
            aria-label="选择审批与权限模式"
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
              imageReading ||
              draftImages.length >= MAX_DRAFT_IMAGES ||
              draftImages.reduce((total, image) => total + image.size, 0) >=
                MAX_TOTAL_IMAGE_BYTES
            }
            onClick={() => imageInputRef.current?.click()}
          >
            ＋
          </button>
          <textarea aria-label="向 Codex 提问" value={draft} onChange={(event) => onDraftChange(event.target.value)} placeholder="向 Codex 提问" rows={1} />
          <button
            type={busy ? "button" : "submit"}
            onClick={busy ? onInterrupt : undefined}
            className="send-button"
            aria-label={busy ? "停止" : "发送"}
            disabled={
              !busy &&
              (imageReading || (!draft.trim() && !draftImages.length))
            }
          >
            <AppIcon name={busy ? "stop" : "send"} />
          </button>
        </div>
      </form>
    </section>
  );
}

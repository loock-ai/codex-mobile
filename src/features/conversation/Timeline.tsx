import { useEffect, useRef, useState, type RefObject } from "react";
import { AppServerClient } from "../../app-server/client";
import type { BackendConfig } from "../../backends/types";
import {
  automationAgentMessageText,
  groupTimelineEntries,
  groupTurnItems,
  imageSourcesForItem,
  MarkdownMessage,
  parseAutomationHeartbeat,
  shouldCollapseUserMessage,
  splitCompletedTurnResponses,
  splitTurnResponseSegments,
  stripGitDirectives,
  summarizeToolActivity,
  toolActivityRowLabel,
  turnDurationMs,
  type ImageSource,
} from "../../ui/conversation";
import { CopyButton, visibleAssistantText } from "../../ui/copy";
import { Chevron } from "../../ui/icons";
import {
  RemoteFileLink,
  RemoteImage,
  RemoteVideo,
  isPreviewableVideoPath,
} from "./sheets/RemoteFileSheets";
import { t, getActiveLocale } from "../../i18n";
import {
  FileDiffSheet,
  ToolDetailSheet,
} from "./sheets/ToolSheets";

type AnyRecord = Record<string, any>;

function itemText(item: AnyRecord) {
  if (typeof item.aggregatedOutput === "string") return item.aggregatedOutput;
  if (typeof item.text === "string") return item.text;
  if (typeof item.content === "string") return item.content;
  if (Array.isArray(item.content)) {
    return item.content.map((part: AnyRecord) => part.text ?? "").join("");
  }
  if (typeof item.command === "string") return item.command;
  if (Array.isArray(item.command)) return item.command.join(" ");
  if (typeof item.output === "string") return item.output;
  return "";
}

function videoPathForItem(item: AnyRecord) {
  const candidate = item.savedPath ?? item.path ?? item.result;
  return typeof candidate === "string" &&
    candidate.startsWith("/") &&
    isPreviewableVideoPath(candidate)
    ? candidate
    : "";
}

function ImageGallery({
  images,
  client,
}: {
  images: ImageSource[];
  client: AppServerClient | null;
}) {
  if (!images.length) return null;
  return (
    <div className={`message-images ${images.length === 1 ? "single" : ""}`}>
      {images.map((image, index) => (
        <RemoteImage
          key={`${image.source}-${index}`}
          image={image}
          client={client}
        />
      ))}
    </div>
  );
}

function UserBubble({
  item,
  client,
  backend,
}: {
  item: AnyRecord;
  client: AppServerClient | null;
  backend?: BackendConfig | null;
}) {
  const rawText = itemText(item);
  const heartbeat = parseAutomationHeartbeat(rawText);
  const text = heartbeat?.instructions ?? rawText;
  const images = imageSourcesForItem(item);
  const collapsible = shouldCollapseUserMessage(text);
  const [expanded, setExpanded] = useState(false);
  const bubble = (
    <div className="user-bubble">
      {text && (
        <div
          className={`user-message-text ${collapsible && !expanded ? "collapsed" : ""}`}
        >
          <MarkdownMessage
            text={text}
            className="user-markdown"
            renderImage={(source, alt) => (
              <RemoteImage
                image={{
                  source,
                  name: source.split("/").at(-1) || alt,
                  local: !/^(data:|https?:)/i.test(source),
                }}
                client={client}
                alt={alt}
              />
            )}
            renderLink={(href, children) => (
              <RemoteFileLink href={href} client={client} backend={backend}>
                {children}
              </RemoteFileLink>
            )}
          />
        </div>
      )}
      <ImageGallery images={images} client={client} />
      {collapsible && (
        <button
          type="button"
          className="user-message-toggle"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setExpanded((current) => !current);
          }}
        >
          {expanded ? t("收起") : t("展开更多")}
          <Chevron direction={expanded ? "up" : "down"} />
        </button>
      )}
    </div>
  );
  if (!heartbeat) return bubble;
  return (
    <div className="automation-user-message">
      <small className="automation-message-label">
        {t("通过自动化功能发送")}
      </small>
      {bubble}
    </div>
  );
}

function ToolActivity({ items }: { items: AnyRecord[] }) {
  const summary = summarizeToolActivity(items);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const selected = selectedIndex == null ? null : items[selectedIndex] ?? null;
  const [expanded, setExpanded] = useState(summary.running);
  const parts = [
    summary.fileCount ? t("已更改 {count} 个文件", { count: summary.fileCount }) : "",
    summary.commandCount
      ? t(summary.running ? "正在运行 {count} 个命令" : "已运行 {count} 个命令", {
          count: summary.commandCount,
        })
      : "",
    summary.toolCount ? t("已调用 {count} 个工具", { count: summary.toolCount }) : "",
  ].filter(Boolean);
  return (
    <>
      <details
        className="tool-activity"
        open={summary.running || expanded}
        onToggle={(event) => {
          if (!summary.running) setExpanded(event.currentTarget.open);
        }}
      >
        <summary>
          <span className="activity-icon">‹/›</span>
          <span className="activity-summary-text">
            {parts.join(getActiveLocale() === "zh-CN" ? "，" : ", ") || t("工具活动")}
            {summary.additions > 0 && <em className="diff-add">+{summary.additions}</em>}
            {summary.deletions > 0 && <em className="diff-delete">-{summary.deletions}</em>}
          </span>
          <Chevron direction={summary.running || expanded ? "down" : "right"} />
        </summary>
        <div className="tool-activity-rows">
          {items.map((item, index) => (
            <button
              type="button"
              key={item.id ?? index}
              aria-label={toolActivityRowLabel(item)}
              onClick={() => setSelectedIndex(index)}
            >
              <span className={item.status === "inProgress" ? "row-running" : ""}>‹/›</span>
              <strong>{toolActivityRowLabel(item)}</strong>
              <Chevron />
            </button>
          ))}
        </div>
      </details>
      {selected?.type === "fileChange" && (
        <FileDiffSheet item={selected} onClose={() => setSelectedIndex(null)} />
      )}
      {selected && selected.type !== "fileChange" && (
        <ToolDetailSheet item={selected} onClose={() => setSelectedIndex(null)} />
      )}
    </>
  );
}

function TimelineItem({
  item,
  client,
  backend,
}: {
  item: AnyRecord;
  client: AppServerClient | null;
  backend?: BackendConfig | null;
}) {
  const type = String(item.type ?? "");
  if (type === "contextCompaction") {
    return (
      <div
        className="context-compaction"
        role="separator"
        aria-label={t("上下文已压缩")}
      >
        <span aria-hidden="true">⟳</span>
        <strong>{t("上下文已压缩")}</strong>
      </div>
    );
  }
  const rawText = itemText(item);
  const text = type === "agentMessage"
    ? automationAgentMessageText(rawText)
    : rawText;
  if (!text && !type) return null;
  if (type === "userMessage") {
    return <UserBubble item={item} client={client} backend={backend} />;
  }
  const displayText = type === "agentMessage"
    ? visibleAgentMessageText(item)
    : text;
  const generatedVideoPath = videoPathForItem(item);
  if (backend && generatedVideoPath) {
    return <RemoteVideo path={generatedVideoPath} backend={backend} />;
  }
  const images = imageSourcesForItem(item);
  if (images.length) return <ImageGallery images={images} client={client} />;
  if (/reasoning/i.test(type)) {
    return displayText ? <div className="reasoning">{displayText}</div> : null;
  }
  return displayText ? (
    <div className="assistant-message">
      <MarkdownMessage
        text={displayText}
        renderImage={(source, alt) => (
          <RemoteImage
            image={{
              source,
              name: source.split("/").at(-1) || alt,
              local: !/^(data:|https?:)/i.test(source),
            }}
            client={client}
            alt={alt}
          />
        )}
        renderLink={(href, children) => (
          <RemoteFileLink href={href} client={client} backend={backend}>
            {children}
          </RemoteFileLink>
        )}
      />
    </div>
  ) : null;
}

function StreamCharacterCount({
  count,
  startedAt,
}: {
  count: number;
  startedAt?: number | null;
}) {
  const [now, setNow] = useState(Date.now);
  const hasStartedAt =
    typeof startedAt === "number" && Number.isFinite(startedAt);

  useEffect(() => {
    if (!hasStartedAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hasStartedAt, startedAt]);

  const elapsedLabel = hasStartedAt
    ? formatTurnDuration(Math.max(0, now - startedAt * 1000))
    : null;
  return (
    <div
      className="stream-character-count"
      aria-label={`${t("已接收 {count} 字符", { count })}${
        elapsedLabel ? t("，已运行 {elapsed}", { elapsed: elapsedLabel }) : ""
      }`}
    >
      <i className="stream-character-spinner" aria-hidden="true" />
      <span>{t("{count} 字符", { count })}</span>
      {elapsedLabel && (
        <span className="stream-elapsed">· {elapsedLabel}</span>
      )}
    </div>
  );
}

function visibleAgentMessageText(item: AnyRecord) {
  return stripGitDirectives(
    automationAgentMessageText(itemText(item)),
  );
}

function formatTurnDuration(durationMs: number) {
  const totalSeconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return t("{hours}小时{minutes}", {
      hours,
      minutes: minutes > 0 ? t("{count}分", { count: minutes }) : "",
    }).trim();
  }
  if (minutes > 0) {
    return t("{minutes}分{seconds}", {
      minutes,
      seconds: seconds > 0 ? t("{count}秒", { count: seconds }) : "",
    }).trim();
  }
  return t("{seconds}秒", { seconds });
}

function valueCharacterCount(value: unknown) {
  if (value == null) return 0;
  const text =
    typeof value === "string"
      ? value
      : JSON.stringify(value);
  return Array.from(text ?? "").length;
}

export function receivedItemCharacterCount(item: AnyRecord) {
  if (
    item.type === "userMessage" ||
    item.type === "contextCompaction" ||
    item.type === "imageView" ||
    item.type === "imageGeneration"
  ) {
    return 0;
  }
  if (item.type === "agentMessage") {
    return Array.from(visibleAgentMessageText(item)).length;
  }
  if (/reasoning/i.test(String(item.type ?? ""))) {
    return valueCharacterCount(
      item.text ?? item.summary ?? item.content,
    );
  }
  if (item.type === "commandExecution") {
    return (
      valueCharacterCount(item.command) +
      valueCharacterCount(item.aggregatedOutput ?? item.output)
    );
  }
  if (item.type === "fileChange") {
    return valueCharacterCount(
      item.changes ?? item.result ?? item.error ?? item.contentItems,
    );
  }
  if (
    /tool/i.test(String(item.type ?? "")) ||
    item.tool != null
  ) {
    return (
      valueCharacterCount(item.tool) +
      valueCharacterCount(item.arguments) +
      valueCharacterCount(
        item.result ??
        item.error ??
        item.contentItems ??
        item.output,
      )
    );
  }
  return valueCharacterCount(itemText(item));
}

export function TurnCard({
  turn,
  client,
  backend,
}: {
  turn: AnyRecord;
  liveDiff?: string;
  client: AppServerClient | null;
  backend?: BackendConfig | null;
}) {
  const grouped = groupTurnItems(turn);
  const responsesRef = useRef<HTMLDivElement>(null);
  let lastHumanIndex = -1;
  for (let index = grouped.responses.length - 1; index >= 0; index -= 1) {
    if (grouped.responses[index]?.type === "userMessage") {
      lastHumanIndex = index;
      break;
    }
  }
  const activeResponseItems = grouped.responses.slice(lastHumanIndex + 1);
  const streamingCharacterCount = activeResponseItems.reduce(
    (total: number, item: AnyRecord) =>
      total + receivedItemCharacterCount(item),
    0,
  );
  const renderEntries = (items: AnyRecord[]) =>
    groupTimelineEntries(items).map((entry, index) =>
      entry.kind === "activity" ? (
        <ToolActivity
          key={`activity-${entry.items[0]?.id ?? index}`}
          items={entry.items}
        />
      ) : (
        <TimelineItem
          key={entry.item.id ?? index}
          item={entry.item}
          client={client}
          backend={backend}
        />
      ),
    );
  const completedSegments = splitTurnResponseSegments(grouped.responses);
  const durationMs = turnDurationMs(turn);
  const durationLabel =
    durationMs != null && durationMs > 60_000
      ? formatTurnDuration(durationMs)
      : null;
  let durationSegmentIndex = -1;
  if (durationLabel) {
    for (let index = completedSegments.length - 1; index >= 0; index -= 1) {
      if (
        splitCompletedTurnResponses(completedSegments[index]).previousCount > 0
      ) {
        durationSegmentIndex = index;
        break;
      }
    }
  }
  let copySegmentIndex = -1;
  for (let index = completedSegments.length - 1; index >= 0; index -= 1) {
    if (
      completedSegments[index]?.some(
        (item) => item.type === "agentMessage",
      )
    ) {
      copySegmentIndex = index;
      break;
    }
  }
  return (
    <section className="turn-card">
      {grouped.user && (
        <div className="turn-user">
          <UserBubble item={grouped.user} client={client} backend={backend} />
        </div>
      )}
      <div className="turn-responses" ref={responsesRef}>
        {grouped.running ? (
          <>
            {renderEntries(grouped.responses)}
            <StreamCharacterCount
              count={streamingCharacterCount}
              startedAt={turn.startedAt}
            />
          </>
        ) : (
          completedSegments.map((items, index) => (
            <CompletedResponseSegment
              key={items[0]?.id ?? index}
              items={items}
              client={client}
              backend={backend}
              copyTarget={responsesRef}
              showCopy={index === copySegmentIndex}
              durationLabel={
                index === durationSegmentIndex ? durationLabel : null
              }
            />
          ))
        )}
      </div>
    </section>
  );
}

function CompletedResponseSegment({
  items,
  client,
  backend,
  copyTarget,
  showCopy,
  durationLabel,
}: {
  items: AnyRecord[];
  client: AppServerClient | null;
  backend?: BackendConfig | null;
  copyTarget: RefObject<HTMLDivElement | null>;
  showCopy: boolean;
  durationLabel: string | null;
}) {
  const completed = splitCompletedTurnResponses(items);
  const [showPrevious, setShowPrevious] = useState(false);
  const guidingMessages = completed.beforeFinal.filter(
    (item) => item.type === "userMessage",
  );
  const processBeforeFinal = completed.beforeFinal.filter(
    (item) => item.type !== "userMessage",
  );
  const renderEntries = (entries: AnyRecord[]) =>
    groupTimelineEntries(entries).map((entry, index) =>
      entry.kind === "activity" ? (
        <ToolActivity
          key={`activity-${entry.items[0]?.id ?? index}`}
          items={entry.items}
        />
      ) : (
        <TimelineItem
          key={entry.item.id ?? index}
          item={entry.item}
          client={client}
          backend={backend}
        />
      ),
    );
  const renderUnfoldedEntries = (entries: AnyRecord[]) =>
    renderEntries(
      entries.filter(
        (item) =>
          item.type === "userMessage" ||
          Boolean(videoPathForItem(item)) ||
          (
            completed.previousCount === 0 &&
            item.type === "contextCompaction"
          ),
      ),
    );
  return (
    <>
      {renderEntries(guidingMessages)}
      {completed.previousCount > 0 && (
        <>
          <button
            type="button"
            className="previous-messages-toggle"
            aria-expanded={showPrevious}
            aria-label={`${t("之前的 {count} 条消息", { count: completed.previousCount })}${
              durationLabel ? ` · ${durationLabel}` : ""
            }`}
            onClick={() => setShowPrevious((current) => !current)}
          >
            {t("之前的 {count} 条消息", { count: completed.previousCount })}
            {durationLabel && (
              <span className="turn-duration">· {durationLabel}</span>
            )}
            <Chevron direction={showPrevious ? "down" : "right"} />
          </button>
          {showPrevious && (
            <div className="previous-messages">
              {renderEntries(processBeforeFinal)}
            </div>
          )}
        </>
      )}
      {!showPrevious && renderUnfoldedEntries(processBeforeFinal)}
      {completed.final && (
        <>
          <TimelineItem
            item={completed.final}
            client={client}
            backend={backend}
          />
          {showCopy && (
            <CopyButton
              text={() => visibleAssistantText(copyTarget.current)}
              label={t("复制本回合 AI 消息")}
              className="turn-message-copy"
            />
          )}
        </>
      )}
      {showPrevious ? (
        completed.afterFinal.length > 0 && (
          <div className="previous-messages after-final">
            {renderEntries(completed.afterFinal)}
          </div>
        )
      ) : (
        renderUnfoldedEntries(completed.afterFinal)
      )}
    </>
  );
}

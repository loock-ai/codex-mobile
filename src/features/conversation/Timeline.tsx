import { useEffect, useRef, useState } from "react";
import { AppServerClient } from "../../app-server/client";
import {
  groupTimelineEntries,
  groupTurnItems,
  imageSourcesForItem,
  MarkdownMessage,
  shouldCollapseUserMessage,
  splitCompletedTurnResponses,
  summarizeToolActivity,
  toolActivityRowLabel,
  type ImageSource,
} from "../../ui/conversation";
import { Chevron } from "../../ui/icons";
import {
  RemoteFileLink,
  RemoteImage,
} from "./sheets/RemoteFileSheets";
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
}: {
  item: AnyRecord;
  client: AppServerClient | null;
}) {
  const text = itemText(item);
  const images = imageSourcesForItem(item);
  const collapsible = shouldCollapseUserMessage(text);
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="user-bubble">
      {text && (
        <div
          className={`user-message-text ${collapsible && !expanded ? "collapsed" : ""}`}
        >
          <MarkdownMessage
            text={text}
            className="user-markdown"
            renderLink={(href, children) => (
              <RemoteFileLink href={href} client={client}>
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
          {expanded ? "收起" : "展开更多"}
          <Chevron direction={expanded ? "up" : "down"} />
        </button>
      )}
    </div>
  );
}

function ToolActivity({ items }: { items: AnyRecord[] }) {
  const summary = summarizeToolActivity(items);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const selected = selectedIndex == null ? null : items[selectedIndex] ?? null;
  const [expanded, setExpanded] = useState(summary.running);
  const parts = [
    summary.fileCount ? `已更改 ${summary.fileCount} 个文件` : "",
    summary.commandCount
      ? `${summary.running ? "正在运行" : "已运行"} ${summary.commandCount} 个命令`
      : "",
    summary.toolCount ? `已调用 ${summary.toolCount} 个工具` : "",
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
            {parts.join("，") || "工具活动"}
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
}: {
  item: AnyRecord;
  client: AppServerClient | null;
}) {
  const type = String(item.type ?? "");
  const text = itemText(item);
  if (!text && !type) return null;
  if (type === "userMessage") return <UserBubble item={item} client={client} />;
  const images = imageSourcesForItem(item);
  if (images.length) return <ImageGallery images={images} client={client} />;
  if (/reasoning/i.test(type)) {
    return text ? <div className="reasoning">{text}</div> : null;
  }
  return text ? (
    <div className="assistant-message">
      <MarkdownMessage
        text={text}
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
          <RemoteFileLink href={href} client={client}>
            {children}
          </RemoteFileLink>
        )}
      />
    </div>
  ) : null;
}

export function TurnCard({
  turn,
  liveDiff,
  client,
}: {
  turn: AnyRecord;
  liveDiff?: string;
  client: AppServerClient | null;
}) {
  const grouped = groupTurnItems(turn);
  const completed = splitCompletedTurnResponses(grouped.responses);
  const [showPrevious, setShowPrevious] = useState(false);
  const wasRunning = useRef(grouped.running);
  useEffect(() => {
    if (wasRunning.current && !grouped.running) setShowPrevious(false);
    wasRunning.current = grouped.running;
  }, [grouped.running]);
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
        />
      ),
    );
  return (
    <section className="turn-card">
      {grouped.user && (
        <div className="turn-user">
          <UserBubble item={grouped.user} client={client} />
        </div>
      )}
      <div className="turn-responses">
        {grouped.running ? (
          <>
            {renderEntries(grouped.responses)}
            {liveDiff && (
              <details className="tool-card diff-card" open>
                <summary>代码变更</summary>
                <pre>{liveDiff}</pre>
              </details>
            )}
          </>
        ) : (
          <>
            {completed.previousCount > 0 && (
              <>
                <button
                  type="button"
                  className="previous-messages-toggle"
                  aria-expanded={showPrevious}
                  onClick={() => setShowPrevious((current) => !current)}
                >
                  之前的 {completed.previousCount} 条消息
                  <Chevron direction={showPrevious ? "down" : "right"} />
                </button>
                {showPrevious && (
                  <div className="previous-messages">
                    {renderEntries(completed.previous)}
                    {liveDiff && (
                      <details className="tool-card diff-card">
                        <summary>代码变更</summary>
                        <pre>{liveDiff}</pre>
                      </details>
                    )}
                  </div>
                )}
              </>
            )}
            {completed.final && (
              <TimelineItem item={completed.final} client={client} />
            )}
          </>
        )}
      </div>
    </section>
  );
}

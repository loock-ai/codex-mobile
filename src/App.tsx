import {
  FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { AppServerClient, type RpcMessage } from "./app-server/client";
import { createLatestThreadListLoader } from "./app-server/thread-list-loader";
import {
  applyCompletedTurn,
  applyFileChangePatch,
  applyTurnDiff,
  applyTurnItem,
  applyTurnStarted,
  groupTimelineEntries,
  groupTurnItems,
  imageSourcesForItem,
  isThreadRunning,
  MarkdownMessage,
  parseUnifiedDiff,
  parseRemoteFileHref,
  relativeTime,
  removePendingTurn,
  shouldCollapseUserMessage,
  splitCompletedTurnResponses,
  summarizeFileChange,
  summarizeToolActivity,
  toolActivityRowLabel,
  type ImageSource,
} from "./ui/conversation";
import { resumeThreadSession } from "./app-server/thread-session";
import { Chevron } from "./ui/icons";
import {
  MAX_DRAFT_IMAGES,
  MAX_TOTAL_IMAGE_BYTES,
  ImageReadGeneration,
  buildOptimisticUserContent,
  buildTurnInput,
  mergeDraftImages,
  prepareImageFiles,
  type DraftImage,
} from "./ui/attachments";
import {
  effortLabel,
  effortOptionsForModel,
  modelOptionMeta,
  normalizeModelSettings,
  permissionModeFromSettings,
  permissionModesFromProfiles,
  permissionProfileLabel,
  speedOptionsForModel,
  type ApprovalPolicy,
  type ApprovalsReviewer,
  type PermissionModeId,
} from "./ui/settings";

type AnyRecord = Record<string, any>;
type ConnectionState = "connecting" | "online" | "offline";
type ThreadListState = "loading" | "ready" | "error";

function wsUrl() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const token = new URLSearchParams(location.search).get("token");
  return `${protocol}//${location.host}/ws${token ? `?token=${encodeURIComponent(token)}` : ""}`;
}

function titleOf(thread: AnyRecord) {
  return thread.name || thread.preview || "新对话";
}

function icon(
  name:
    | "back"
    | "search"
    | "compose"
    | "send"
    | "stop"
    | "more"
    | "download",
) {
  const paths = {
    back: <path d="M15 18l-6-6 6-6M9 12h11" />,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
    compose: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 013 3L8 18l-4 1 1-4z" /></>,
    send: <><path d="m5 12 7-7 7 7" /><path d="M12 19V5" /></>,
    stop: <rect x="7" y="7" width="10" height="10" rx="2" />,
    more: <><circle cx="12" cy="5" r="1.2" fill="currentColor" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /><circle cx="12" cy="19" r="1.2" fill="currentColor" /></>,
    download: <><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

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

function imageMime(source: string) {
  const extension = source.split(/[?#]/)[0]?.split(".").at(-1)?.toLowerCase();
  return (
    {
      avif: "image/avif",
      gif: "image/gif",
      jpeg: "image/jpeg",
      jpg: "image/jpeg",
      png: "image/png",
      svg: "image/svg+xml",
      webp: "image/webp",
    }[extension ?? ""] ?? "image/png"
  );
}

function formatImageSize(bytes: number | null) {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function decodeBase64File(dataBase64: string) {
  const binary = window.atob(dataBase64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const text = new TextDecoder("utf-8").decode(bytes);
  const replacementCount = Array.from(text).filter(
    (character) => character === "\uFFFD",
  ).length;
  return {
    bytes: bytes.byteLength,
    text,
    binary:
      bytes.includes(0) ||
      (text.length > 0 && replacementCount / text.length > 0.02),
  };
}

function RemoteImage({
  image,
  client,
  alt,
}: {
  image: ImageSource;
  client: AppServerClient | null;
  alt?: string;
}) {
  const [src, setSrc] = useState(image.local ? "" : image.source);
  const [size, setSize] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    if (!image.local) {
      setSrc(image.source);
      setSize(null);
      return () => {
        cancelled = true;
      };
    }
    setSrc("");
    if (!client) return;
    void client
      .request<{ dataBase64: string }>("fs/readFile", { path: image.source })
      .then((result) => {
        if (cancelled) return;
        setSize(Math.floor((result.dataBase64.length * 3) / 4));
        setSrc(`data:${imageMime(image.source)};base64,${result.dataBase64}`);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [client, image.local, image.source]);

  if (failed) {
    return <div className="image-load-error">无法读取 {image.name}</div>;
  }
  if (!src) return <div className="image-placeholder" aria-label={`正在加载 ${image.name}`} />;

  return (
    <>
      <button
        type="button"
        className="message-image-button"
        aria-label={`查看图片 ${image.name}`}
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
      >
        <img src={src} alt={alt || image.name} />
      </button>
      {open && (
        <div
          className="remote-file-backdrop"
          onClick={(event) => {
            event.stopPropagation();
            setOpen(false);
          }}
        >
          <section
            className="remote-file-sheet"
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <h3>远程文件</h3>
              <a href={src} download={image.name} aria-label="下载图片">
                {icon("download")}
              </a>
            </header>
            <img className="remote-file-preview" src={src} alt={alt || image.name} />
            <p><strong>{image.name}</strong>{size != null ? ` (${formatImageSize(size)})` : ""}</p>
            <p className="remote-file-path">{image.source}</p>
            <button
              type="button"
              className="sheet-close"
              aria-label="关闭远程文件"
              onClick={() => setOpen(false)}
            >
              完成
            </button>
          </section>
        </div>
      )}
    </>
  );
}

function RemoteTextFileSheet({
  href,
  path,
  line,
  client,
  onClose,
}: {
  href: string;
  path: string;
  line: number | null;
  client: AppServerClient | null;
  onClose: () => void;
}) {
  const [state, setState] = useState<{
    status: "loading" | "ready" | "error";
    text: string;
    dataBase64: string;
    bytes: number | null;
    binary: boolean;
    error: string;
  }>({
    status: "loading",
    text: "",
    dataBase64: "",
    bytes: null,
    binary: false,
    error: "",
  });
  const targetLineRef = useRef<HTMLDivElement | null>(null);
  const name = path.split("/").filter(Boolean).at(-1) || "远程文件";

  useEffect(() => {
    let cancelled = false;
    setState({
      status: "loading",
      text: "",
      dataBase64: "",
      bytes: null,
      binary: false,
      error: "",
    });
    if (!client) {
      setState((current) => ({
        ...current,
        status: "error",
        error: "尚未连接 app-server",
      }));
      return () => {
        cancelled = true;
      };
    }
    void client
      .request<{ dataBase64: string }>("fs/readFile", { path })
      .then((result) => {
        if (cancelled) return;
        const decoded = decodeBase64File(result.dataBase64);
        setState({
          status: "ready",
          text: decoded.text,
          dataBase64: result.dataBase64,
          bytes: decoded.bytes,
          binary: decoded.binary,
          error: "",
        });
      })
      .catch((reason) => {
        if (cancelled) return;
        setState((current) => ({
          ...current,
          status: "error",
          error: reason instanceof Error ? reason.message : String(reason),
        }));
      });
    return () => {
      cancelled = true;
    };
  }, [client, path]);

  useEffect(() => {
    if (state.status !== "ready" || line == null) return;
    targetLineRef.current?.scrollIntoView({ block: "center" });
  }, [line, state.status]);

  const lines = state.text.split("\n");
  if (lines.at(-1) === "") lines.pop();

  return (
    <div className="remote-file-backdrop" onClick={onClose}>
      <section
        className="remote-text-sheet"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <h3>远程文件</h3>
          <div className="remote-text-actions">
            {state.dataBase64 && (
              <a
                href={`data:text/plain;charset=utf-8;base64,${state.dataBase64}`}
                download={name}
                aria-label="下载文件"
              >
                {icon("download")}
              </a>
            )}
            <button
              type="button"
              aria-label="关闭远程文件"
              onClick={onClose}
            >
              ×
            </button>
          </div>
        </header>
        <div className="remote-text-file-name">
          <strong>{name}</strong>
          {state.bytes != null ? ` (${formatImageSize(state.bytes)})` : ""}
        </div>
        <div className="remote-text-content">
          {state.status === "loading" && (
            <div className="remote-text-status" role="status">
              正在读取文件…
            </div>
          )}
          {state.status === "error" && (
            <div className="remote-text-status error" role="alert">
              无法读取文件：{state.error}
            </div>
          )}
          {state.status === "ready" && state.binary && (
            <div className="remote-text-status">
              这是二进制文件，无法作为文本预览
            </div>
          )}
          {state.status === "ready" && !state.binary && !lines.length && (
            <div className="remote-text-status">文件内容为空</div>
          )}
          {state.status === "ready" &&
            !state.binary &&
            lines.map((content, index) => {
              const lineNumber = index + 1;
              const target = lineNumber === line;
              return (
                <div
                  className={`remote-text-line${target ? " target" : ""}`}
                  key={lineNumber}
                  ref={target ? targetLineRef : undefined}
                >
                  <span>{lineNumber}</span>
                  <code>{content || " "}</code>
                </div>
              );
            })}
        </div>
        <footer>
          <p className="remote-file-path">{href}</p>
        </footer>
      </section>
    </div>
  );
}

function RemoteFileLink({
  href,
  children,
  client,
}: {
  href: string;
  children: ReactNode;
  client: AppServerClient | null;
}) {
  const target = parseRemoteFileHref(href);
  const [open, setOpen] = useState(false);
  if (!target) return <a href={href}>{children}</a>;
  return (
    <>
      <a
        href={href}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
        }}
      >
        {children}
      </a>
      {open &&
        createPortal(
          <RemoteTextFileSheet
            href={href}
            path={target.path}
            line={target.line}
            client={client}
            onClose={() => setOpen(false)}
          />,
          document.body,
        )}
    </>
  );
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

function ToolDetailSheet({
  item,
  onClose,
}: {
  item: AnyRecord;
  onClose: () => void;
}) {
  const isCommand = item.type === "commandExecution";
  const isFile = item.type === "fileChange";
  const title = isCommand
    ? "命令执行"
    : isFile
      ? "文件修改"
      : item.type === "collabAgentToolCall"
        ? "智能体调用"
        : "工具调用";
  const output =
    item.aggregatedOutput ??
    item.result ??
    item.error ??
    item.contentItems ??
    (isFile ? item.changes : null);
  return (
    <div className="tool-detail-backdrop" onClick={onClose}>
      <section className="tool-detail-sheet" onClick={(event) => event.stopPropagation()}>
        <header>
          <h3>{title}</h3>
          <button type="button" aria-label="关闭工具详情" onClick={onClose}>×</button>
        </header>
        {isCommand && (
          <>
            <h4>命令</h4>
            <code className="detail-command">{item.command}</code>
          </>
        )}
        {isFile && (
          <>
            <h4>文件</h4>
            <div className="detail-file-list">
              {(item.changes ?? []).map((change: AnyRecord) => (
                <code key={change.path}>{change.path}</code>
              ))}
            </div>
          </>
        )}
        {!isCommand && !isFile && (
          <>
            <h4>工具</h4>
            <code className="detail-command">{item.tool || item.type}</code>
          </>
        )}
        <dl>
          <div><dt>状态</dt><dd>{item.status === "inProgress" ? "进行中" : item.status || "已完成"}</dd></div>
          {item.cwd && <div><dt>工作目录</dt><dd>{item.cwd}</dd></div>}
          {item.durationMs != null && <div><dt>耗时</dt><dd>{item.durationMs} ms</dd></div>}
          {item.exitCode != null && <div><dt>退出码</dt><dd>{item.exitCode}</dd></div>}
        </dl>
        {item.arguments != null && (
          <>
            <h4>参数</h4>
            <pre>{JSON.stringify(item.arguments, null, 2)}</pre>
          </>
        )}
        {output != null && (
          <>
            <h4>{isCommand ? "输出" : "详情"}</h4>
            <pre>{typeof output === "string" ? output : JSON.stringify(output, null, 2)}</pre>
          </>
        )}
      </section>
    </div>
  );
}

function diffHunkLabel(lines: ReturnType<typeof parseUnifiedDiff>, index: number) {
  const current = lines[index]?.text.match(
    /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/,
  );
  if (!current) return "上下文";
  const start = Number(current[1]);
  let previousEnd = 1;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (lines[cursor].type !== "hunk") continue;
    const previous = lines[cursor].text.match(
      /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/,
    );
    if (previous) {
      previousEnd = Number(previous[1]) + Number(previous[2] ?? 1);
    }
    break;
  }
  const unchanged = Math.max(0, start - previousEnd);
  return unchanged ? `${unchanged} 行未修改` : "上下文";
}

function FileDiffSheet({
  item,
  onClose,
}: {
  item: AnyRecord;
  onClose: () => void;
}) {
  const changes = (item.changes ?? []) as AnyRecord[];
  const [expandedFiles, setExpandedFiles] = useState<Set<number>>(
    () => new Set(changes.length ? [0] : []),
  );
  return (
    <div className="tool-detail-backdrop" onClick={onClose}>
      <section
        className="file-diff-sheet"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <h3>已更改 {changes.length} 个文件</h3>
          <button
            type="button"
            aria-label="关闭文件修改"
            onClick={onClose}
          >
            •••
          </button>
        </header>
        <div className="file-diff-list">
          {changes.map((change, changeIndex) => {
            const expanded = expandedFiles.has(changeIndex);
            const stats = summarizeFileChange(change);
            const lines = parseUnifiedDiff(change.diff ?? "");
            return (
              <section className="file-diff-entry" key={`${change.path}-${changeIndex}`}>
                <button
                  type="button"
                  className="file-diff-heading"
                  aria-expanded={expanded}
                  title={change.path}
                  onClick={() =>
                    setExpandedFiles((current) => {
                      const next = new Set(current);
                      if (next.has(changeIndex)) next.delete(changeIndex);
                      else next.add(changeIndex);
                      return next;
                    })
                  }
                >
                  <Chevron direction={expanded ? "down" : "right"} />
                  <strong>{change.path || "未命名文件"}</strong>
                  {stats.additions > 0 && (
                    <span className="diff-add">+{stats.additions}</span>
                  )}
                  {stats.deletions > 0 && (
                    <span className="diff-delete">-{stats.deletions}</span>
                  )}
                </button>
                {expanded && (
                  <div className="file-diff-code">
                    {lines.length ? (
                      lines.map((line, lineIndex) =>
                        line.type === "hunk" ? (
                          <div
                            className="file-diff-hunk"
                            title={line.text}
                            key={`${lineIndex}-${line.text}`}
                          >
                            {diffHunkLabel(lines, lineIndex)}
                          </div>
                        ) : (
                          <div
                            className={`file-diff-line ${line.type}`}
                            key={`${lineIndex}-${line.oldLine}-${line.newLine}`}
                          >
                            <span>{line.oldLine ?? ""}</span>
                            <span>{line.newLine ?? ""}</span>
                            <code>{line.text || " "}</code>
                          </div>
                        ),
                      )
                    ) : (
                      <div className="file-diff-empty">暂无 Diff 内容</div>
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </section>
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

function TurnCard({
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
      <div className="turn-user">
        {grouped.user ? (
          <UserBubble item={grouped.user} client={client} />
        ) : (
          <div className="user-bubble">Codex 回合</div>
        )}
      </div>
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

export function App() {
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [threads, setThreads] = useState<AnyRecord[]>([]);
  const [threadListState, setThreadListState] =
    useState<ThreadListState>("loading");
  const [active, setActive] = useState<AnyRecord | null>(null);
  const [query, setQuery] = useState("");
  const [listNow, setListNow] = useState(() =>
    Math.floor(Date.now() / 1000),
  );
  const [draft, setDraft] = useState("");
  const [draftImages, setDraftImages] = useState<DraftImage[]>([]);
  const [imageReading, setImageReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [requests, setRequests] = useState<RpcMessage[]>([]);
  const [userAnswers, setUserAnswers] = useState<Record<string, string>>({});
  const [models, setModels] = useState<AnyRecord[]>([]);
  const [permissionProfiles, setPermissionProfiles] = useState<AnyRecord[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [selectedEffort, setSelectedEffort] = useState<string | null>(null);
  const [selectedServiceTier, setSelectedServiceTier] = useState<string | null>(null);
  const [selectedPermission, setSelectedPermission] = useState("");
  const [selectedApprovalPolicy, setSelectedApprovalPolicy] =
    useState<ApprovalPolicy>("on-request");
  const [selectedApprovalsReviewer, setSelectedApprovalsReviewer] =
    useState<ApprovalsReviewer>("user");
  const [activeSettingsSynchronized, setActiveSettingsSynchronized] =
    useState(true);
  const [openingThreadId, setOpeningThreadId] = useState("");
  const [picker, setPicker] =
    useState<"agent" | "model" | "speed" | "permission" | null>(null);
  const clientRef = useRef<AppServerClient | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const imageReadGenerationRef = useRef(new ImageReadGeneration());
  const draftContextGenerationRef = useRef(0);
  const socketRef = useRef<WebSocket | null>(null);
  const activeRef = useRef<AnyRecord | null>(null);
  const openSequenceRef = useRef(0);
  const threadListLoaderRef = useRef<ReturnType<
    typeof createLatestThreadListLoader
  > | null>(null);
  if (!threadListLoaderRef.current) {
    threadListLoaderRef.current = createLatestThreadListLoader((data) => {
      setThreads(data);
      setThreadListState("ready");
    });
  }

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  async function loadThreads(client = clientRef.current) {
    if (!client || client !== clientRef.current) return;
    try {
      await threadListLoaderRef.current!.load(client);
    } catch (reason) {
      setThreadListState((current) =>
        current === "loading" ? "error" : current,
      );
      throw reason;
    }
  }

  useEffect(() => {
    let cancelled = false;
    const scrollToPageTarget = () => {
      if (cancelled) return;
      window.scrollTo({
        top: active?.id ? document.documentElement.scrollHeight : 0,
        behavior: "auto",
      });
    };
    const frame = window.requestAnimationFrame(scrollToPageTarget);
    const settle = active?.id
      ? window.setTimeout(scrollToPageTarget, 240)
      : undefined;
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      if (settle != null) window.clearTimeout(settle);
    };
  }, [active?.id]);

  useEffect(() => {
    const refresh = window.setInterval(() => {
      setListNow(Math.floor(Date.now() / 1000));
      void loadThreads().catch(() => undefined);
    }, 60_000);
    return () => window.clearInterval(refresh);
  }, []);

  useEffect(() => {
    let disposed = false;
    let retry: number | undefined;
    let retryAttempt = 0;
    const connect = () => {
      if (disposed) return;
      setConnection("connecting");
      const socket = new WebSocket(wsUrl());
      socketRef.current = socket;
      socket.addEventListener("open", async () => {
        retryAttempt = 0;
        const client = new AppServerClient(socket);
        clientRef.current = client;
        client.onNotification((message) => {
          const params = (message.params ?? {}) as AnyRecord;
          if (message.method === "turn/started" && params.turn) {
            setActive((current) => {
              if (!current) return current;
              const started = applyTurnStarted(current, params);
              if (started !== current) setBusy(true);
              return started;
            });
          }
          if (message.method === "item/agentMessage/delta" && params.delta) {
            setActive((current) => {
              if (!current || current.id !== params.threadId) return current;
              const copy = structuredClone(current);
              const turn = copy.turns?.find(
                (entry: AnyRecord) => entry.id === params.turnId,
              );
              const item = turn?.items?.find((entry: AnyRecord) => entry.id === params.itemId);
              if (!item) return current;
              if (item) item.text = `${item.text ?? ""}${params.delta}`;
              return copy;
            });
          }
          if (message.method === "item/started" && params.item) {
            setActive((current) =>
              current ? applyTurnItem(current, params) : current,
            );
          }
          if (message.method === "item/completed" && params.item) {
            setActive((current) =>
              current ? applyTurnItem(current, params) : current,
            );
          }
          if (
            message.method === "item/commandExecution/outputDelta" ||
            message.method === "item/fileChange/outputDelta" ||
            message.method === "item/reasoning/summaryTextDelta" ||
            message.method === "item/reasoning/textDelta"
          ) {
            const streamMethod = message.method ?? "";
            setActive((current) => {
              if (!current || current.id !== params.threadId) return current;
              const copy = structuredClone(current);
              const turn = copy.turns?.find(
                (entry: AnyRecord) => entry.id === params.turnId,
              );
              const item = turn?.items?.find((entry: AnyRecord) => entry.id === params.itemId);
              if (!item) return current;
              if (item) {
                const key = streamMethod.includes("commandExecution") || streamMethod.includes("fileChange")
                  ? "aggregatedOutput"
                  : "text";
                item[key] = `${item[key] ?? ""}${params.delta ?? ""}`;
              }
              return copy;
            });
          }
          if (message.method === "item/fileChange/patchUpdated") {
            setActive((current) =>
              current ? applyFileChangePatch(current, params) : current,
            );
          }
          if (message.method === "turn/diff/updated") {
            setActive((current) =>
              current ? applyTurnDiff(current, params) : current,
            );
          }
          if (message.method === "turn/completed") {
            setActive((current) => {
              if (!current) return current;
              const completed = applyCompletedTurn(current, params);
              if (completed === current) return current;
              setBusy(false);
              return completed;
            });
            void loadThreads(client);
          }
          if (
            message.method === "thread/settings/updated" &&
            activeRef.current?.id === params.threadId
          ) {
            const settings = (params.threadSettings ?? {}) as AnyRecord;
            if (typeof settings.model === "string") setSelectedModel(settings.model);
            if ("effort" in settings) {
              setSelectedEffort(settings.effort ?? null);
            }
            if ("serviceTier" in settings) {
              setSelectedServiceTier(settings.serviceTier ?? null);
            }
            if (settings.approvalPolicy) {
              setSelectedApprovalPolicy(settings.approvalPolicy as ApprovalPolicy);
            }
            if (settings.approvalsReviewer) {
              setSelectedApprovalsReviewer(
                settings.approvalsReviewer as ApprovalsReviewer,
              );
            }
            if ("activePermissionProfile" in settings) {
              setSelectedPermission(settings.activePermissionProfile?.id ?? "");
            }
            setActiveSettingsSynchronized(true);
          }
        });
        client.onRequest((request) => {
          if (
            request.method === "item/commandExecution/requestApproval" ||
            request.method === "item/fileChange/requestApproval" ||
            request.method === "item/permissions/requestApproval" ||
            request.method === "item/tool/requestUserInput"
          ) {
            setRequests((current) => [...current, request]);
          } else {
            client.respondError(
              request.id!,
              -32601,
              `Codex Mobile Web 暂不支持服务器请求：${request.method}`,
            );
          }
        });
        try {
          await client.initialize();
          if (!disposed) {
            setConnection("online");
            setError("");
            const [modelResult, permissionResult, configResult] = await Promise.all([
              client.request<{ data: AnyRecord[] }>("model/list", {
                limit: 100,
                includeHidden: false,
              }),
              client.request<{ data: AnyRecord[] }>("permissionProfile/list", {
                limit: 100,
                cwd: null,
              }),
              client
                .request<{ config: AnyRecord }>("config/read", {
                  cwd: null,
                  includeLayers: false,
                })
                .catch(() => ({ config: {} })),
            ]);
            const availableProfiles = permissionResult.data.filter(
              (profile) => profile.allowed,
            );
            const config = (configResult.config ?? {}) as AnyRecord;
            const configuredModel =
              config.model ||
              modelResult.data.find((model) => model.isDefault)?.model ||
              modelResult.data[0]?.model ||
              "";
            const configuredCatalog = modelResult.data.find(
              (model) => model.model === configuredModel,
            );
            const normalized = normalizeModelSettings(
              configuredCatalog,
              config.model_reasoning_effort,
              config.service_tier,
            );
            const sandboxProfileId =
              config.sandbox_mode === "workspace-write"
                ? ":workspace"
                : typeof config.sandbox_mode === "string"
                  ? `:${config.sandbox_mode}`
                  : "";
            const configuredPermission =
              availableProfiles.find((profile) => profile.id === sandboxProfileId)
                ?.id ||
              availableProfiles.find((profile) => profile.id === ":workspace")?.id ||
              availableProfiles.find((profile) => profile.id === ":read-only")?.id ||
              availableProfiles[0]?.id ||
              "";
            setModels(modelResult.data);
            setPermissionProfiles(availableProfiles);
            setSelectedModel((current) => current || configuredModel);
            setSelectedEffort((current) => current ?? normalized.effort);
            setSelectedServiceTier(
              (current) => current ?? normalized.serviceTier,
            );
            setSelectedPermission((current) => current || configuredPermission);
            setSelectedApprovalPolicy(
              (current) =>
                config.approval_policy ||
                (configuredPermission === ":danger-full-access"
                  ? "never"
                  : current),
            );
            setSelectedApprovalsReviewer(
              (current) => config.approvals_reviewer || current,
            );
            await loadThreads(client);
            const currentThread = activeRef.current;
            if (currentThread?.id) {
              const resumed = await resumeThreadSession(client, currentThread.id);
              if (!disposed && activeRef.current?.id === currentThread.id) {
                const resumedSettings = normalizeModelSettings(
                  modelResult.data.find(
                    (model) => model.model === resumed.model,
                  ),
                  resumed.reasoningEffort,
                  resumed.serviceTier,
                );
                setActive(resumed.thread);
                setActiveSettingsSynchronized(resumed.settingsSynchronized);
                setSelectedModel(resumed.model ?? "");
                setSelectedEffort(resumedSettings.effort);
                setSelectedServiceTier(resumedSettings.serviceTier);
                if (resumed.approvalPolicy) {
                  setSelectedApprovalPolicy(resumed.approvalPolicy);
                }
                if (resumed.approvalsReviewer) {
                  setSelectedApprovalsReviewer(resumed.approvalsReviewer);
                }
                setSelectedPermission(resumed.activePermissionProfile?.id ?? "");
                const lastTurn = resumed.thread.turns?.at(-1);
                setBusy(
                  ["inProgress", "in_progress", "running"].includes(lastTurn?.status),
                );
              }
            }
          }
        } catch (reason) {
          if (!disposed) setError(reason instanceof Error ? reason.message : String(reason));
        }
      });
      socket.addEventListener("close", () => {
        if (!disposed) {
          if (socketRef.current === socket) clientRef.current = null;
          setConnection("offline");
          setBusy(false);
          setRequests([]);
          const delay = Math.min(15_000, 750 * 2 ** retryAttempt++);
          retry = window.setTimeout(connect, delay);
        }
      });
    };
    connect();
    return () => {
      disposed = true;
      if (retry) clearTimeout(retry);
      socketRef.current?.close();
    };
  }, []);

  const visibleThreads = useMemo(
    () => threads.filter((thread) => titleOf(thread).toLowerCase().includes(query.toLowerCase())),
    [query, threads],
  );

  function invalidateImageReads() {
    imageReadGenerationRef.current.invalidate();
    setImageReading(false);
    if (imageInputRef.current) imageInputRef.current.value = "";
  }

  function resetDraftContext() {
    draftContextGenerationRef.current += 1;
    invalidateImageReads();
  }

  async function openThread(thread: AnyRecord) {
    const sequence = ++openSequenceRef.current;
    resetDraftContext();
    setDraft("");
    setDraftImages([]);
    setOpeningThreadId(thread.id);
    setError("");
    try {
      const session = await resumeThreadSession(clientRef.current!, thread.id);
      if (sequence !== openSequenceRef.current) return;
      const resumedSettings = normalizeModelSettings(
        models.find((model) => model.model === session.model),
        session.reasoningEffort,
        session.serviceTier,
      );
      setActive(session.thread);
      setActiveSettingsSynchronized(session.settingsSynchronized);
      setSelectedModel(session.model ?? "");
      setSelectedEffort(resumedSettings.effort);
      setSelectedServiceTier(resumedSettings.serviceTier);
      if (session.approvalPolicy) {
        setSelectedApprovalPolicy(session.approvalPolicy);
      }
      if (session.approvalsReviewer) {
        setSelectedApprovalsReviewer(session.approvalsReviewer);
      }
      setSelectedPermission(session.activePermissionProfile?.id ?? "");
      const lastTurn = session.thread.turns?.at(-1);
      setBusy(
        ["inProgress", "in_progress", "running"].includes(lastTurn?.status),
      );

      if (session.thread.cwd) {
        void clientRef.current
          ?.request<{ data: AnyRecord[] }>("permissionProfile/list", {
            limit: 100,
            cwd: session.thread.cwd,
          })
          .then((result) => {
            if (sequence === openSequenceRef.current) {
              setPermissionProfiles(result.data.filter((profile) => profile.allowed));
            }
          })
          .catch(() => undefined);
      }
    } catch (reason) {
      if (sequence === openSequenceRef.current) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      if (sequence === openSequenceRef.current) setOpeningThreadId("");
    }
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    const pendingImages = draftImages;
    if (
      imageReading ||
      (!text && !pendingImages.length) ||
      !clientRef.current ||
      busy
    ) {
      return;
    }
    const draftContext = draftContextGenerationRef.current;
    invalidateImageReads();
    setDraft("");
    setDraftImages([]);
    setBusy(true);
    const pendingTurnId = `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let thread = active;
    try {
      const shouldSendSettings = !thread?.id || activeSettingsSynchronized;
      if (!thread?.id) {
        const started = await clientRef.current.request<{
          thread: AnyRecord;
          model?: string;
          reasoningEffort?: string | null;
          serviceTier?: string | null;
          approvalPolicy?: ApprovalPolicy;
          approvalsReviewer?: ApprovalsReviewer;
          activePermissionProfile?: { id: string } | null;
        }>("thread/start", {
          cwd: null,
          ...(selectedModel ? { model: selectedModel } : {}),
          ...(selectedServiceTier ? { serviceTier: selectedServiceTier } : {}),
          ...(selectedPermission ? { permissions: selectedPermission } : {}),
          approvalPolicy: selectedApprovalPolicy,
          approvalsReviewer: selectedApprovalsReviewer,
        });
        thread = started.thread;
        const startedModel = started.model || selectedModel;
        const startedSettings = normalizeModelSettings(
          models.find((model) => model.model === startedModel),
          started.reasoningEffort ?? selectedEffort,
          started.serviceTier ?? selectedServiceTier,
        );
        if (started.model) setSelectedModel(started.model);
        setSelectedEffort(startedSettings.effort);
        setSelectedServiceTier(startedSettings.serviceTier);
        if (started.approvalPolicy) {
          setSelectedApprovalPolicy(started.approvalPolicy);
        }
        if (started.approvalsReviewer) {
          setSelectedApprovalsReviewer(started.approvalsReviewer);
        }
        if (started.activePermissionProfile?.id) {
          setSelectedPermission(started.activePermissionProfile.id);
        }
        setActiveSettingsSynchronized(true);
        setActive(thread);
      }
      const localItem = {
        id: `local-${pendingTurnId}`,
        type: "userMessage",
        content: buildOptimisticUserContent(text, pendingImages),
      };
      setActive((current) => ({
        ...(current ?? thread!),
        turns: [
          ...(current?.turns ?? thread!.turns ?? []),
          {
            id: pendingTurnId,
            status: "inProgress",
            items: [localItem],
          },
        ],
      }));
      const startedTurn = await clientRef.current.request<{ turn: AnyRecord }>("turn/start", {
        threadId: thread.id,
        input: buildTurnInput(text, pendingImages),
        ...(shouldSendSettings && selectedModel ? { model: selectedModel } : {}),
        ...(shouldSendSettings && selectedEffort
          ? { effort: selectedEffort }
          : {}),
        ...(shouldSendSettings && selectedServiceTier
          ? { serviceTier: selectedServiceTier }
          : {}),
        ...(shouldSendSettings && selectedPermission
          ? { permissions: selectedPermission }
          : {}),
        ...(shouldSendSettings
          ? {
              approvalPolicy: selectedApprovalPolicy,
              approvalsReviewer: selectedApprovalsReviewer,
            }
          : {}),
      });
      setActive((current) => {
        if (!current) return current;
        return applyTurnStarted(current, {
          threadId: thread!.id,
          turn: startedTurn.turn,
        });
      });
    } catch (reason) {
      if (draftContext === draftContextGenerationRef.current) {
        setBusy(false);
        setActive((current) =>
          current && current.id === thread?.id
            ? removePendingTurn(current, pendingTurnId)
            : current,
        );
        setDraft((current) => current || text);
        setDraftImages((current) => mergeDraftImages(current, pendingImages));
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    }
  }

  async function selectImages(files: FileList | null) {
    if (!files?.length) return;
    const generation = imageReadGenerationRef.current.begin();
    const existingBytes = draftImages.reduce(
      (total, image) => total + image.size,
      0,
    );
    setImageReading(true);
    try {
      const result = await prepareImageFiles(
        files,
        draftImages.length,
        undefined,
        existingBytes,
      );
      if (!imageReadGenerationRef.current.isCurrent(generation)) return;
      setDraftImages((current) => mergeDraftImages(current, result.images));
      if (result.errors.length) setError(result.errors.join("；"));
      else setError("");
    } finally {
      if (imageReadGenerationRef.current.isCurrent(generation)) {
        setImageReading(false);
      }
    }
  }

  async function interrupt() {
    const turn = active?.turns?.at(-1);
    if (!turn) return;
    await clientRef.current?.request("turn/interrupt", { threadId: active!.id, turnId: turn.id });
  }

  const turns = active?.turns ?? [];
  const selectedModelEntry =
    models.find((model) => model.model === selectedModel) ?? null;
  const selectedModelLabel =
    !activeSettingsSynchronized && active?.id
      ? "沿用线程模型"
      : selectedModelEntry?.displayName ||
        selectedModel ||
        "默认模型";
  const effortOptions = effortOptionsForModel(selectedModelEntry);
  const speedOptions = speedOptionsForModel(selectedModelEntry);
  const selectedSpeedLabel =
    speedOptions.find((option) => option.id === selectedServiceTier)?.label ??
    "正常";
  const permissionModes = permissionModesFromProfiles(
    permissionProfiles as Array<{ id: string; allowed?: boolean }>,
  );
  const selectedPermissionModeId = permissionModeFromSettings(
    selectedPermission,
    selectedApprovalPolicy,
    selectedApprovalsReviewer,
  );
  const selectedPermissionMode = permissionModes.find(
    (mode) => mode.id === selectedPermissionModeId,
  );
  const selectedPermissionLabel =
    !activeSettingsSynchronized && active?.id
      ? "沿用线程权限"
      : selectedPermissionMode?.label ??
        permissionProfileLabel(
          selectedPermission,
          permissionProfiles.find(
            (profile) => profile.id === selectedPermission,
          )?.description,
        );
  const chooseModel = (modelId: string) => {
    const model = models.find((option) => option.model === modelId);
    const normalized = normalizeModelSettings(
      model,
      selectedEffort,
      selectedServiceTier,
    );
    setSelectedModel(modelId);
    setSelectedEffort(normalized.effort);
    setSelectedServiceTier(normalized.serviceTier);
  };
  const choosePermissionMode = (modeId: PermissionModeId) => {
    const mode = permissionModes.find((option) => option.id === modeId);
    if (!mode) return;
    setSelectedPermission(mode.permissions);
    setSelectedApprovalPolicy(mode.approvalPolicy);
    setSelectedApprovalsReviewer(mode.approvalsReviewer);
    setPicker(null);
  };
  const approval = requests[0] ?? null;
  const finishRequest = (decision: "accept" | "decline") => {
    if (!approval) return;
    const params = (approval.params ?? {}) as AnyRecord;
    if (approval.method === "item/permissions/requestApproval") {
      const requested = (params.permissions ?? {}) as AnyRecord;
      const granted = {
        ...(requested.fileSystem != null ? { fileSystem: requested.fileSystem } : {}),
        ...(requested.network != null ? { network: requested.network } : {}),
      };
      clientRef.current?.respond(approval.id!, {
        permissions: decision === "accept" ? granted : {},
        scope: "turn",
      });
    } else {
      clientRef.current?.respond(approval.id!, { decision });
    }
    setRequests((current) => current.slice(1));
  };
  const answerQuestions = () => {
    if (!approval) return;
    const questions = ((approval.params as AnyRecord)?.questions ?? []) as AnyRecord[];
    clientRef.current?.respond(approval.id!, {
      answers: Object.fromEntries(
        questions.map((question) => [question.id, { answers: [userAnswers[question.id] ?? ""] }]),
      ),
    });
    setUserAnswers({});
    setRequests((current) => current.slice(1));
  };

  return (
    <main className="app-shell">
      {active ? (
        <section className="conversation">
          <header className="conversation-header">
            <button
              className="round-button"
              aria-label="返回"
              onClick={() => {
                openSequenceRef.current += 1;
                resetDraftContext();
                const threadId = active.id;
                setDraft("");
                setDraftImages([]);
                setActive(null);
                setBusy(false);
                if (threadId && !busy) {
                  void clientRef.current
                    ?.request("thread/unsubscribe", { threadId })
                    .catch(() => undefined);
                }
              }}
            >
              {icon("back")}
            </button>
            <div className="thread-heading">
              <strong>{titleOf(active)}</strong>
              <span><i className={`status-dot ${connection}`} /> {active.cwd?.split("/").pop() || "Codex"} · {connection === "online" ? "已连接" : "连接中"}</span>
            </div>
            <button className="round-button" aria-label="更多">{icon("more")}</button>
          </header>
          <div className="timeline">
            {turns.length ? turns.map((turn: AnyRecord, index: number) => (
              <TurnCard
                key={turn.id ?? index}
                turn={turn}
                liveDiff={turn.liveDiff}
                client={clientRef.current}
              />
            )) : <div className="empty-state">开始一次新的 Codex 对话</div>}
          </div>
          {error && <div className="error-banner" role="alert">{error}</div>}
          <form
            className="composer-wrap"
            aria-busy={imageReading}
            onSubmit={send}
          >
            {draftImages.length > 0 && (
              <div className="draft-images" aria-label="待发送图片">
                {draftImages.map((image) => (
                  <figure key={image.id}>
                    <img src={image.url} alt={`待发送 ${image.name}`} />
                    <button
                      type="button"
                      aria-label={`移除 ${image.name}`}
                      onClick={() =>
                        setDraftImages((current) =>
                          current.filter((entry) => entry.id !== image.id),
                        )
                      }
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
                onClick={() => setPicker("agent")}
              >
                {selectedServiceTier ? "⚡ " : ""}
                {selectedModelLabel} {effortLabel(selectedEffort)}
              </button>
              <button
                type="button"
                aria-label="选择审批与权限模式"
                onClick={() => setPicker("permission")}
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
                  void selectImages(input.files).finally(() => {
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
              <textarea aria-label="向 Codex 提问" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="向 Codex 提问" rows={1} />
              <button
                type={busy ? "button" : "submit"}
                onClick={busy ? interrupt : undefined}
                className="send-button"
                aria-label={busy ? "停止" : "发送"}
                disabled={
                  !busy &&
                  (imageReading || (!draft.trim() && !draftImages.length))
                }
              >
                {icon(busy ? "stop" : "send")}
              </button>
            </div>
          </form>
        </section>
      ) : (
        <section className="thread-list-page">
          <header className="list-header">
            <button className="round-button" aria-label="返回">{icon("back")}</button>
            <div>
              <h1>Remote</h1>
              <p><i className={`status-dot ${connection}`} /> {location.hostname} · {connection === "online" ? "已连接" : connection === "offline" ? "已断开" : "连接中"}</p>
            </div>
            <button className="round-button" aria-label="更多">{icon("more")}</button>
          </header>
          <div className="host-pill"><i className={`status-dot ${connection}`} />▰ <strong>{location.hostname}</strong></div>
          <h2>最近</h2>
          <div className="thread-list">
            {threadListState === "loading" && (
              <div
                className="thread-list-skeleton"
                aria-label="正在加载会话"
                role="status"
              >
                {Array.from({ length: 5 }, (_, index) => (
                  <div className="thread-row-skeleton" key={index}>
                    <i />
                    <i />
                  </div>
                ))}
              </div>
            )}
            {threadListState !== "loading" && visibleThreads.map((thread) => (
              <button
                key={thread.id}
                className="thread-row"
                disabled={openingThreadId === thread.id}
                aria-busy={openingThreadId === thread.id}
                onClick={() => void openThread(thread)}
              >
                <span>{titleOf(thread)}</span>
                {isThreadRunning(thread.status) ? (
                  <span className="thread-running" aria-label="进行中">
                    <i className="running-dot" />
                    <i className="running-spinner" />
                  </span>
                ) : (
                  <time>
                    {relativeTime(
                      thread.updatedAt ?? thread.createdAt ?? 0,
                      listNow,
                    )}
                  </time>
                )}
              </button>
            ))}
            {threadListState === "ready" && !visibleThreads.length && (
              <div className="empty-state">
                {query.trim() ? "没有匹配的对话" : "暂无对话"}
              </div>
            )}
            {threadListState === "error" && !threads.length && (
              <div className="empty-state">无法加载会话</div>
            )}
          </div>
          {error && <div className="error-banner" role="alert">{error}</div>}
          <footer className="list-actions">
            <label className="search-box">{icon("search")}<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索聊天" /></label>
            <button
              className="new-chat"
              onClick={() => {
                openSequenceRef.current += 1;
                resetDraftContext();
                setOpeningThreadId("");
                setDraft("");
                setDraftImages([]);
                setActiveSettingsSynchronized(true);
                setActive({ id: "", turns: [], preview: "新对话" });
              }}
            >
              {icon("compose")}聊天
            </button>
          </footer>
        </section>
      )}
      {approval && (
        <div className="approval-backdrop">
          <section className="approval-sheet">
            <small>需要你的确认</small>
            {approval.method === "item/tool/requestUserInput" ? (
              <>
                <h3>Codex 需要你的回答</h3>
                {(((approval.params as AnyRecord)?.questions ?? []) as AnyRecord[]).map((question) => (
                  <label className="question-field" key={question.id}>
                    <strong>{question.header}</strong>
                    <span>{question.question}</span>
                    {question.options?.length ? (
                      <select value={userAnswers[question.id] ?? ""} onChange={(event) => setUserAnswers((current) => ({ ...current, [question.id]: event.target.value }))}>
                        <option value="">请选择</option>
                        {question.options.map((option: AnyRecord) => <option key={option.label} value={option.label}>{option.label}</option>)}
                      </select>
                    ) : (
                      <input type={question.isSecret ? "password" : "text"} value={userAnswers[question.id] ?? ""} onChange={(event) => setUserAnswers((current) => ({ ...current, [question.id]: event.target.value }))} />
                    )}
                  </label>
                ))}
                <div><button className="approve" onClick={answerQuestions}>提交回答</button></div>
              </>
            ) : (
              <>
                <h3>{approval.method?.includes("fileChange") ? "允许修改文件？" : approval.method?.includes("permissions") ? "授予附加权限？" : "允许运行此操作？"}</h3>
                <pre>{JSON.stringify(approval.params, null, 2)}</pre>
                <div>
                  <button onClick={() => finishRequest("decline")}>拒绝</button>
                  <button className="approve" onClick={() => finishRequest("accept")}>允许</button>
                </div>
              </>
            )}
          </section>
        </div>
      )}
      {picker && (
        <div className="composer-popover-backdrop" onClick={() => setPicker(null)}>
          <section
            className={`composer-popover ${picker === "permission" ? "permission-popover" : ""}`}
            aria-label={
              picker === "permission"
                ? "权限模式"
                : picker === "model"
                  ? "模型"
                  : picker === "speed"
                    ? "速度"
                    : "智能"
            }
            onClick={(event) => event.stopPropagation()}
          >
            {picker === "agent" && (
              <>
                <div className="popover-eyebrow">智能</div>
                <div className="popover-options effort-options">
                  {effortOptions.map((option) => {
                    const selected = option.id === selectedEffort;
                    return (
                      <button
                        key={option.id}
                        className={selected ? "selected" : ""}
                        aria-pressed={selected}
                        onClick={() => {
                          setSelectedEffort(option.id);
                          setPicker(null);
                        }}
                      >
                        <span>
                          <strong>{option.label}</strong>
                          {option.description && <small>{option.description}</small>}
                        </span>
                        <i>{selected ? "✓" : ""}</i>
                      </button>
                    );
                  })}
                </div>
                <div className="popover-divider" />
                <button className="popover-link" onClick={() => setPicker("model")}>
                  <span><strong>模型</strong><small>{selectedModelLabel}</small></span>
                  <Chevron />
                </button>
                <button className="popover-link" onClick={() => setPicker("speed")}>
                  <span><strong>速度</strong><small>{selectedSpeedLabel}</small></span>
                  <Chevron />
                </button>
              </>
            )}
            {picker === "model" && (
              <>
                <button className="popover-title" onClick={() => setPicker("agent")}>
                  <span><strong>模型</strong><small>{selectedModelLabel}</small></span>
                  <Chevron direction="down" />
                </button>
                <div className="popover-divider" />
                <div className="popover-options model-options" aria-label="模型列表">
                  {models.map((option) => {
                    const value = option.model;
                    const selected = value === selectedModel;
                    const meta = modelOptionMeta(option);
                    return (
                      <button
                        key={option.id || value}
                        className={selected ? "selected" : ""}
                        aria-pressed={selected}
                        onClick={() => {
                          chooseModel(value);
                          setPicker(null);
                        }}
                      >
                        <span>
                          <strong>{option.displayName}</strong>
                          <small>{meta.description || meta.identity}</small>
                        </span>
                        <i>{selected ? "✓" : ""}</i>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
            {picker === "speed" && (
              <>
                <button className="popover-title" onClick={() => setPicker("agent")}>
                  <span><strong>速度</strong><small>{selectedSpeedLabel}</small></span>
                  <Chevron direction="down" />
                </button>
                <div className="popover-divider" />
                <div className="popover-options" aria-label="速度列表">
                  {speedOptions.map((option) => {
                    const selected = option.id === selectedServiceTier;
                    return (
                      <button
                        key={option.id ?? "normal"}
                        className={selected ? "selected" : ""}
                        aria-pressed={selected}
                        onClick={() => {
                          setSelectedServiceTier(option.id);
                          setPicker(null);
                        }}
                      >
                        <span>
                          <strong>{option.label}</strong>
                          <small>{option.description}</small>
                        </span>
                        <i>{selected ? "✓" : ""}</i>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
            {picker === "permission" && (
              <div className="popover-options permission-options">
                {permissionModes.map((mode) => {
                  const selected = mode.id === selectedPermissionModeId;
                  return (
                    <button
                      key={mode.id}
                      className={selected ? "selected" : ""}
                      aria-pressed={selected}
                      onClick={() => choosePermissionMode(mode.id)}
                    >
                      <span>
                        <strong>{mode.label}</strong>
                        <small>{mode.description}</small>
                      </span>
                      <i>{selected ? "✓" : ""}</i>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

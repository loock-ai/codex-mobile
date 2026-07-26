import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export type ConversationRecord = Record<string, any>;

export type RemoteFileTarget = {
  path: string;
  line: number | null;
  column: number | null;
};

const remoteFileRoots = [
  "/Users/",
  "/home/",
  "/tmp/",
  "/private/",
  "/var/",
  "/opt/",
  "/workspace/",
  "/workspaces/",
  "/repo/",
  "/app/",
];

export function parseRemoteFileHref(
  href: string | null | undefined,
): RemoteFileTarget | null {
  if (!href) return null;
  let decoded = href;
  try {
    decoded = href.startsWith("file://")
      ? new URL(href).pathname
      : decodeURIComponent(href);
  } catch {
    return null;
  }
  if (!remoteFileRoots.some((root) => decoded.startsWith(root))) return null;
  const location = decoded.match(/^(.*?):(\d+)(?::(\d+))?$/);
  const path = location?.[1] ?? decoded;
  if (!path || path.endsWith("/")) return null;
  return {
    path,
    line: location ? Number(location[2]) : null,
    column: location?.[3] ? Number(location[3]) : null,
  };
}

export function removePendingTurn(
  thread: ConversationRecord,
  pendingTurnId: string,
) {
  const turns = (thread.turns ?? []) as ConversationRecord[];
  const index = turns.findIndex((turn) => turn.id === pendingTurnId);
  if (index < 0) return thread;
  return {
    ...thread,
    turns: turns.filter((_, turnIndex) => turnIndex !== index),
  };
}

export function relativeTime(timestamp: number, now = Math.floor(Date.now() / 1000)) {
  const elapsed = Math.max(0, Math.floor(now - timestamp));
  if (elapsed < 60) return "刚刚";
  if (elapsed < 3600) return `${Math.floor(elapsed / 60)} 分钟`;
  if (elapsed < 86400) return `${Math.floor(elapsed / 3600)} 小时`;
  return `${Math.floor(elapsed / 86400)} 天`;
}

export function isThreadRunning(status: unknown) {
  return (
    typeof status === "object" &&
    status !== null &&
    (status as { type?: unknown }).type === "active"
  );
}

const toolActivityTypes = new Set([
  "commandExecution",
  "fileChange",
  "mcpToolCall",
  "dynamicToolCall",
  "collabToolCall",
  "collabAgentToolCall",
  "subAgentActivity",
  "webSearch",
  "sleep",
]);

export function isToolActivityItem(item: ConversationRecord) {
  return toolActivityTypes.has(String(item.type ?? ""));
}

export type TimelineEntry =
  | { kind: "item"; item: ConversationRecord }
  | { kind: "activity"; items: ConversationRecord[] };

export function groupTimelineEntries(
  items: ConversationRecord[],
): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  for (const item of items) {
    if (!isToolActivityItem(item)) {
      entries.push({ kind: "item", item });
      continue;
    }
    const previous = entries.at(-1);
    if (previous?.kind === "activity") {
      previous.items.push(item);
    } else {
      entries.push({ kind: "activity", items: [item] });
    }
  }
  return entries;
}

export type ParsedDiffLine = {
  type: "hunk" | "context" | "addition" | "deletion" | "meta";
  text: string;
  oldLine: number | null;
  newLine: number | null;
};

export function parseUnifiedDiff(diff: string): ParsedDiffLine[] {
  if (!diff) return [];
  const sourceLines = diff.split("\n");
  let oldLine: number | null = null;
  let newLine: number | null = null;
  const parsed: ParsedDiffLine[] = [];

  sourceLines.forEach((line, index) => {
    if (index === sourceLines.length - 1 && line === "") return;
    const hunk = line.match(
      /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/,
    );
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      parsed.push({
        type: "hunk",
        text: line,
        oldLine: null,
        newLine: null,
      });
      return;
    }
    if (line.startsWith("---") || line.startsWith("+++")) return;
    if (line.startsWith("\\ No newline")) {
      parsed.push({
        type: "meta",
        text: line,
        oldLine: null,
        newLine: null,
      });
      return;
    }
    if (line.startsWith("+")) {
      parsed.push({
        type: "addition",
        text: line.slice(1),
        oldLine: null,
        newLine,
      });
      if (newLine != null) newLine += 1;
      return;
    }
    if (line.startsWith("-")) {
      parsed.push({
        type: "deletion",
        text: line.slice(1),
        oldLine,
        newLine: null,
      });
      if (oldLine != null) oldLine += 1;
      return;
    }
    parsed.push({
      type: "context",
      text: line.startsWith(" ") ? line.slice(1) : line,
      oldLine,
      newLine,
    });
    if (oldLine != null) oldLine += 1;
    if (newLine != null) newLine += 1;
  });

  return parsed;
}

function diffLineStats(diff: string) {
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
    if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
  }
  return { additions, deletions };
}

export function summarizeFileChange(change: ConversationRecord) {
  return diffLineStats(
    typeof change.diff === "string" ? change.diff : "",
  );
}

export function summarizeToolActivity(items: ConversationRecord[]) {
  const files = new Set<string>();
  let commandCount = 0;
  let toolCount = 0;
  let additions = 0;
  let deletions = 0;
  let running = false;
  for (const item of items) {
    if (item.status === "inProgress") running = true;
    if (item.type === "commandExecution") commandCount += 1;
    else if (item.type === "fileChange") {
      for (const change of item.changes ?? []) {
        if (change.path) files.add(change.path);
        const stats = diffLineStats(change.diff ?? "");
        additions += stats.additions;
        deletions += stats.deletions;
      }
    } else {
      toolCount += 1;
    }
  }
  return {
    fileCount: files.size,
    commandCount,
    toolCount,
    additions,
    deletions,
    running,
  };
}

function shortValue(value: unknown, fallback: string) {
  if (typeof value !== "string" || !value) return fallback;
  return value.split(/[\\/]/).filter(Boolean).at(-1) ?? value;
}

export function toolActivityRowLabel(item: ConversationRecord) {
  const running = item.status === "inProgress";
  if (item.type === "commandExecution") {
    const action = item.commandActions?.[0];
    if (action?.type === "read") {
      return `${running ? "正在读取" : "已读取"} ${shortValue(action.name || action.path, "文件")}`;
    }
    if (action?.type === "listFiles") {
      return `${running ? "正在查看" : "已查看"} ${shortValue(action.path, "文件")}`;
    }
    if (action?.type === "search") {
      return `${running ? "正在搜索" : "已搜索"} ${action.query || shortValue(action.path, "内容")}`;
    }
    return `${running ? "正在运行" : item.status === "failed" ? "执行失败" : "已执行"} ${item.command || "命令"}`;
  }
  if (item.type === "fileChange") {
    const changes = item.changes ?? [];
    const target =
      changes.length === 1
        ? shortValue(changes[0]?.path, "文件")
        : `${changes.length} 个文件`;
    return `${running ? "正在修改" : item.status === "failed" ? "修改失败" : "已编辑"} ${target}`;
  }
  if (item.type === "sleep") return "已等待";
  if (
    item.type === "collabToolCall" ||
    item.type === "collabAgentToolCall"
  ) {
    return `${running ? "正在调用" : "已调用"}智能体 ${item.tool ?? ""}`.trim();
  }
  const name = item.tool || item.query || item.type || "工具";
  return `${running ? "正在调用" : "已调用"} ${name}`;
}

export interface ImageSource {
  source: string;
  name: string;
  local: boolean;
}

function imageName(source: string) {
  if (source.startsWith("data:")) return "图片";
  try {
    const path = /^https?:/i.test(source) ? new URL(source).pathname : source;
    return decodeURIComponent(
      path.split(/[\\/]/).filter(Boolean).at(-1) ?? "图片",
    );
  } catch {
    return shortValue(source, "图片");
  }
}

export function imageSourcesForItem(
  item: ConversationRecord,
): ImageSource[] {
  if (item.type === "userMessage") {
    return (item.content ?? []).flatMap((part: ConversationRecord) => {
      if (part.type === "localImage" && part.path) {
        return [
          {
            source: part.path,
            name: imageName(part.path),
            local: true,
          },
        ];
      }
      if (part.type === "image" && part.url) {
        return [
          {
            source: part.url,
            name: imageName(part.url),
            local: !/^(data:|https?:)/i.test(part.url),
          },
        ];
      }
      return [];
    });
  }
  if (item.type === "imageView" && item.path) {
    return [
      { source: item.path, name: imageName(item.path), local: true },
    ];
  }
  if (item.type === "imageGeneration") {
    const source =
      item.savedPath ||
      (/^(data:|https?:)/i.test(item.result ?? "") ? item.result : "");
    return source
      ? [{ source, name: imageName(source), local: !/^(data:|https?:)/i.test(source) }]
      : [];
  }
  return [];
}

export function shouldCollapseUserMessage(text: string) {
  return text.length > 260 || text.split("\n").length > 8;
}

export function splitCompletedTurnResponses(
  responses: ConversationRecord[],
) {
  let finalIndex = -1;
  for (let index = responses.length - 1; index >= 0; index -= 1) {
    if (
      responses[index]?.type === "agentMessage" &&
      responses[index]?.phase === "final_answer"
    ) {
      finalIndex = index;
      break;
    }
  }
  if (finalIndex < 0) {
    for (let index = responses.length - 1; index >= 0; index -= 1) {
      if (responses[index]?.type === "agentMessage") {
        finalIndex = index;
        break;
      }
    }
  }
  const final = finalIndex >= 0 ? responses[finalIndex] : null;
  const previous =
    finalIndex >= 0
      ? responses.filter((_, index) => index !== finalIndex)
      : [...responses];
  return { final, previous, previousCount: previous.length };
}

function mergeTurnItems(
  currentItems: ConversationRecord[],
  incomingItems: ConversationRecord[],
) {
  const merged = [...currentItems];
  for (const item of incomingItems) {
    let index = merged.findIndex((current) => current.id === item.id);
    if (index < 0 && item.type === "userMessage") {
      index = merged.findIndex(
        (current) =>
          current.type === "userMessage" &&
          String(current.id ?? "").startsWith("local-"),
      );
    }
    if (index >= 0) merged[index] = { ...merged[index], ...item };
    else merged.push(item);
  }
  return merged;
}

export function applyTurnStarted(
  thread: ConversationRecord,
  params: ConversationRecord,
) {
  if (!thread || thread.id !== params.threadId || !params.turn?.id) {
    return thread;
  }
  const incoming = params.turn as ConversationRecord;
  const turns = (thread.turns ?? []) as ConversationRecord[];
  let index = turns.findIndex((turn) => turn.id === incoming.id);
  if (index < 0) {
    for (let candidate = turns.length - 1; candidate >= 0; candidate -= 1) {
      if (String(turns[candidate]?.id ?? "").startsWith("pending-")) {
        index = candidate;
        break;
      }
    }
  }
  const existing = index >= 0 ? turns[index] : null;
  const replacement = {
    ...(existing ?? {}),
    ...incoming,
    items: mergeTurnItems(existing?.items ?? [], incoming.items ?? []),
  };
  return {
    ...thread,
    turns:
      index >= 0
        ? turns.map((turn, turnIndex) =>
            turnIndex === index ? replacement : turn,
          )
        : [...turns, replacement],
  };
}

export function applyTurnItem(
  thread: ConversationRecord,
  params: ConversationRecord,
) {
  if (
    !thread ||
    thread.id !== params.threadId ||
    !params.turnId ||
    !params.item
  ) {
    return thread;
  }
  const started = applyTurnStarted(thread, {
    threadId: params.threadId,
    turn: { id: params.turnId, status: "inProgress", items: [] },
  });
  const turns = (started.turns ?? []) as ConversationRecord[];
  return {
    ...started,
    turns: turns.map((turn) =>
      turn.id === params.turnId
        ? {
            ...turn,
            items: mergeTurnItems(turn.items ?? [], [params.item]),
          }
        : turn,
    ),
  };
}

export function applyTurnDiff(
  thread: ConversationRecord,
  params: ConversationRecord,
) {
  if (!thread || thread.id !== params.threadId || !params.turnId) {
    return thread;
  }
  const turns = (thread.turns ?? []) as ConversationRecord[];
  const index = turns.findIndex((turn) => turn.id === params.turnId);
  if (index < 0) return thread;
  return {
    ...thread,
    turns: turns.map((turn, turnIndex) =>
      turnIndex === index
        ? { ...turn, liveDiff: params.diff ?? params.patch ?? "" }
        : turn,
    ),
  };
}

export function applyFileChangePatch(
  thread: ConversationRecord,
  params: ConversationRecord,
) {
  if (
    !thread ||
    thread.id !== params.threadId ||
    !params.turnId ||
    !params.itemId
  ) {
    return thread;
  }
  const turns = (thread.turns ?? []) as ConversationRecord[];
  const turnIndex = turns.findIndex((turn) => turn.id === params.turnId);
  const itemIndex = turns[turnIndex]?.items?.findIndex(
    (item: ConversationRecord) => item.id === params.itemId,
  );
  if (turnIndex < 0 || itemIndex == null || itemIndex < 0) return thread;
  return {
    ...thread,
    turns: turns.map((turn, currentTurnIndex) =>
      currentTurnIndex !== turnIndex
        ? turn
        : {
            ...turn,
            items: turn.items.map(
              (item: ConversationRecord, currentItemIndex: number) =>
                currentItemIndex === itemIndex
                  ? { ...item, changes: params.changes ?? [] }
                  : item,
            ),
          },
    ),
  };
}

export function applyCompletedTurn(
  thread: ConversationRecord,
  params: ConversationRecord,
) {
  if (!thread || thread.id !== params.threadId) return thread;
  const completedTurn = params.turn as ConversationRecord | undefined;
  const turnId = completedTurn?.id ?? params.turnId;
  if (!turnId) return thread;
  const withTurn = applyTurnStarted(thread, {
    threadId: params.threadId,
    turn: { ...(completedTurn ?? {}), id: turnId, items: [] },
  });
  const turns = (withTurn.turns ?? []) as ConversationRecord[];
  const index = turns.findIndex((turn) => turn.id === turnId);
  if (index < 0) return withTurn;
  const replacement = {
    ...turns[index],
    ...(completedTurn ?? {}),
    status: completedTurn?.status ?? "completed",
    items: mergeTurnItems(
      turns[index]?.items ?? [],
      completedTurn?.items ?? [],
    ),
  };
  return {
    ...withTurn,
    turns: turns.map((turn, turnIndex) =>
      turnIndex === index ? replacement : turn,
    ),
  };
}

export function groupTurnItems(turn: ConversationRecord) {
  const items = (turn.items ?? []) as ConversationRecord[];
  const userIndex = items.findIndex((item) => item.type === "userMessage");
  return {
    id: turn.id,
    running: ["inProgress", "in_progress", "running"].includes(turn.status),
    user: userIndex >= 0 ? items[userIndex] : null,
    responses: items.filter((_, index) => index !== userIndex),
  };
}

export function MarkdownMessage({
  text,
  renderImage,
  renderLink,
  className = "",
}: {
  text: string;
  renderImage?: (source: string, alt: string) => ReactNode;
  renderLink?: (href: string, children: ReactNode) => ReactNode;
  className?: string;
}) {
  const components = {
    ...(renderImage
      ? {
          img: ({ src, alt }: { src?: string; alt?: string }) => (
            <>{renderImage(src ?? "", alt ?? "图片")}</>
          ),
        }
      : {}),
    ...(renderLink
      ? {
          a: ({
            href,
            children,
          }: {
            href?: string;
            children?: ReactNode;
          }) => <>{renderLink(href ?? "", children)}</>,
        }
      : {}),
  };
  return (
    <div className={`markdown-body ${className}`.trim()}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={components}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

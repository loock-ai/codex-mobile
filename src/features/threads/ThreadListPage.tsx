import {
  isThreadRunning,
  relativeTime,
} from "../../ui/conversation";
import {
  AppIcon,
  titleOf,
  type ConnectionState,
  type DisplayRecord,
  type ThreadListState,
} from "../../ui/app-display";

export function ThreadListPage({
  connection,
  hostname,
  threadListState,
  visibleThreads,
  totalThreadCount,
  openingThreadId,
  query,
  listNow,
  error,
  onQueryChange,
  onOpenThread,
  onNewChat,
}: {
  connection: ConnectionState;
  hostname: string;
  threadListState: ThreadListState;
  visibleThreads: DisplayRecord[];
  totalThreadCount: number;
  openingThreadId: string;
  query: string;
  listNow: number;
  error: string;
  onQueryChange: (value: string) => void;
  onOpenThread: (thread: DisplayRecord) => void | Promise<void>;
  onNewChat: () => void;
}) {
  return (
    <section className="thread-list-page">
      <header className="list-header">
        <button className="round-button" aria-label="返回"><AppIcon name="back" /></button>
        <div>
          <h1>Remote</h1>
          <p><i className={`status-dot ${connection}`} /> {hostname} · {connection === "online" ? "已连接" : connection === "offline" ? "已断开" : "连接中"}</p>
        </div>
        <button className="round-button" aria-label="更多"><AppIcon name="more" /></button>
      </header>
      <div className="host-pill"><i className={`status-dot ${connection}`} />▰ <strong>{hostname}</strong></div>
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
            onClick={() => void onOpenThread(thread)}
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
        {threadListState === "error" && !totalThreadCount && (
          <div className="empty-state">无法加载会话</div>
        )}
      </div>
      {error && <div className="error-banner" role="alert">{error}</div>}
      <footer className="list-actions">
        <label className="search-box"><AppIcon name="search" /><input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="搜索聊天" /></label>
        <button
          className="new-chat"
          onClick={onNewChat}
        >
          <AppIcon name="compose" />聊天
        </button>
      </footer>
    </section>
  );
}

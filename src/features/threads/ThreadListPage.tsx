import {
  isThreadRunning,
  relativeTime,
} from "../../ui/conversation";
import {
  AppIcon,
  titleOf,
  type ThreadListState,
} from "../../ui/app-display";
import type {
  BackendConfig,
  BackendRuntimeSummary,
} from "../../backends/types";
import type { ProjectThreadLoadState } from "../../app-server/thread-list-loader";
import { BackendSwitcher } from "../backends/BackendSwitcher";
import {
  groupThreadsByProject,
  splitAllThreads,
  type AggregatedThreadItem,
} from "./thread-list-model";
import { projectCollapseKey } from "./project-collapse";

export function ThreadListPage({
  backends,
  summaries,
  selectedBackendId,
  loadingBackendIds,
  refreshing,
  threadListState,
  visibleThreads,
  totalThreadCount,
  projectDirectories,
  projectThreadStates,
  projectVisibleCounts,
  collapsedProjectKeys,
  loadingProjectKeys,
  openingThreadId,
  query,
  error,
  onQueryChange,
  onOpenThread,
  onNewChat,
  onSelectBackend,
  onManageBackends,
  onRefresh,
  onRetryProject,
  onToggleProject,
  onToggleProjectCollapsed,
}: {
  backends: BackendConfig[];
  summaries: Record<string, BackendRuntimeSummary>;
  selectedBackendId: string;
  loadingBackendIds: Set<string>;
  refreshing: boolean;
  threadListState: ThreadListState;
  visibleThreads: AggregatedThreadItem[];
  totalThreadCount: number;
  projectDirectories: string[];
  projectThreadStates: Record<string, ProjectThreadLoadState>;
  projectVisibleCounts: Record<string, number>;
  collapsedProjectKeys: Set<string>;
  loadingProjectKeys: Set<string>;
  openingThreadId: string;
  query: string;
  error: string;
  onQueryChange: (value: string) => void;
  onOpenThread: (thread: AggregatedThreadItem) => void | Promise<void>;
  onNewChat: () => void;
  onSelectBackend: (backendId: string) => void;
  onManageBackends: () => void;
  onRefresh: () => void;
  onRetryProject: (backendId: string, cwd: string) => void;
  onToggleProject: (backendId: string, cwd: string) => void;
  onToggleProjectCollapsed: (backendId: string, cwd: string) => void;
}) {
  const enabledBackends = backends.filter((backend) => backend.enabled);
  const onlineCount = enabledBackends.filter(
    (backend) => summaries[backend.id]?.connection === "online",
  ).length;
  const selectedBackend = enabledBackends.find(
    (backend) => backend.id === selectedBackendId,
  );
  const selectedSummary = selectedBackend
    ? summaries[selectedBackend.id]
    : undefined;
  const allGroups = splitAllThreads(visibleThreads);
  const projectGroups = groupThreadsByProject(visibleThreads, projectDirectories);
  const renderNow = Math.floor(Date.now() / 1000);
  const renderRow = (
    thread: AggregatedThreadItem,
    showSource: boolean,
  ) => (
    <button
      key={`${thread.backendId}:${thread.threadId}`}
      className={`thread-row${showSource ? " with-source" : ""}`}
      disabled={openingThreadId === `${thread.backendId}:${thread.threadId}`}
      aria-busy={openingThreadId === `${thread.backendId}:${thread.threadId}`}
      onClick={() => void onOpenThread(thread)}
    >
      <span className="thread-row-title">
        <span>{titleOf(thread.thread)}</span>
      </span>
      {isThreadRunning(thread.status) ? (
        <span className="thread-running" aria-label="进行中">
          <i className="running-dot" />
          <i className="running-spinner" />
        </span>
      ) : (
        <span className="thread-row-meta">
          {thread.unread && (
            <i className="thread-unread-dot" aria-label="未读" />
          )}
          <time>{relativeTime(thread.timestamp, renderNow)}</time>
        </span>
      )}
      {showSource && (
        <small className="thread-source">
          {thread.backendName} · {thread.projectName}
        </small>
      )}
    </button>
  );

  return (
    <section className="thread-list-page">
      <div className="thread-list-sticky">
        <header className="list-header">
          <div>
            <h1>Codex Mobile</h1>
            <p>
              <i
                className={`status-dot ${
                  onlineCount ? "online" : "connecting"
                }`}
              />
              {selectedBackend
                ? `${selectedBackend.name} · ${
                    selectedSummary?.connection === "online"
                      ? "已连接"
                      : selectedSummary?.connection === "offline"
                        ? "已断开"
                        : "连接中"
                  }`
                : `${enabledBackends.length} 台机器 · ${onlineCount} 台已连接`}
            </p>
          </div>
          <div className="list-header-actions">
            <button
              className={`round-button${refreshing ? " refreshing" : ""}`}
              aria-label="刷新会话列表"
              aria-busy={refreshing}
              onClick={onRefresh}
            >
              <AppIcon name="refresh" />
            </button>
            <button
              className="round-button"
              aria-label="管理设备"
              onClick={onManageBackends}
            >
              <AppIcon name="more" />
            </button>
          </div>
        </header>
        <BackendSwitcher
          backends={backends}
          summaries={summaries}
          selectedBackendId={selectedBackendId}
          loadingBackendIds={loadingBackendIds}
          onSelect={onSelectBackend}
        />
      </div>
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
        {threadListState !== "loading" && selectedBackendId === "all" && (
          <>
            {!!allGroups.pinned.length && (
              <section className="thread-section">
                <h2>置顶</h2>
                {allGroups.pinned.map((thread) => renderRow(thread, true))}
              </section>
            )}
            {!!allGroups.recent.length && (
              <section className="thread-section">
                <h2>最近</h2>
                {allGroups.recent.map((thread) => renderRow(thread, true))}
              </section>
            )}
          </>
        )}
        {threadListState !== "loading" && selectedBackendId !== "all" && (
          <>
            {projectGroups
              .filter(
                (group) => !query.trim() || group.threads.length > 0,
              )
              .map((group) => {
                const projectKey = projectCollapseKey(
                  selectedBackendId,
                  group.cwd,
                );
                const isExpanded =
                  Boolean(query.trim()) ||
                  !collapsedProjectKeys.has(projectKey);
                const visibleCount =
                  projectVisibleCounts[projectKey] ?? 5;
                const isLoadingMore = loadingProjectKeys.has(projectKey);
                const projectThreadState =
                  projectThreadStates[group.cwd] ??
                  (group.threads.length ? "ready" : "idle");
                const showInitialLoading =
                  projectThreadState === "loading" &&
                  group.threads.length === 0;
                const showInitialError =
                  projectThreadState === "error" &&
                  group.threads.length === 0;
                return (
                  <section className="project-group" key={group.cwd}>
                    <h2>
                      <button
                        type="button"
                        className="project-heading"
                        aria-expanded={isExpanded}
                        onClick={() =>
                          onToggleProjectCollapsed(
                            selectedBackendId,
                            group.cwd,
                          )
                        }
                      >
                        <AppIcon
                          name={isExpanded ? "folder-open" : "folder"}
                        />
                        <span>{group.projectName}</span>
                      </button>
                    </h2>
                    {isExpanded && (
                      <>
                        {group.threads
                          .slice(0, visibleCount)
                          .map((thread) => renderRow(thread, false))}
                        {showInitialLoading && (
                          <div
                            className="project-thread-skeleton"
                            aria-label="正在加载项目会话"
                            role="status"
                          >
                            {Array.from({ length: 3 }, (_, index) => (
                              <div className="thread-row-skeleton" key={index}>
                                <i />
                                <i />
                              </div>
                            ))}
                          </div>
                        )}
                        {showInitialError && (
                          <button
                            type="button"
                            className="project-retry"
                            aria-label={`重试加载 ${group.projectName} 会话`}
                            onClick={() =>
                              onRetryProject(selectedBackendId, group.cwd)
                            }
                          >
                            加载失败，点击重试
                          </button>
                        )}
                        {!showInitialLoading &&
                          !showInitialError &&
                          (isLoadingMore ||
                            group.threads.length >= visibleCount) && (
                          <button
                            type="button"
                            className="project-more"
                            disabled={isLoadingMore}
                            aria-busy={isLoadingMore}
                            onClick={() =>
                              onToggleProject(
                                selectedBackendId,
                                group.cwd,
                              )
                            }
                          >
                            {isLoadingMore ? (
                              <>
                                <i
                                  className="action-spinner"
                                  aria-hidden="true"
                                />
                                加载中
                              </>
                            ) : (
                              "展开显示"
                            )}
                          </button>
                        )}
                      </>
                    )}
                  </section>
                );
              })}
          </>
        )}
        {threadListState === "ready" &&
          !visibleThreads.length &&
          (selectedBackendId === "all" ||
            !projectDirectories.length ||
            Boolean(query.trim())) && (
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

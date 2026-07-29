import type {
  BackendConfig,
  BackendRuntimeSummary,
} from "../../backends/types";

function statusLabel(summary: BackendRuntimeSummary | undefined) {
  if (!summary || summary.connection === "connecting") return "连接中";
  if (summary.connection === "online") return "已连接";
  return "已断开";
}

export function BackendSwitcher({
  backends,
  summaries,
  selectedBackendId,
  loadingBackendIds = new Set<string>(),
  onSelect,
}: {
  backends: BackendConfig[];
  summaries: Record<string, BackendRuntimeSummary>;
  selectedBackendId: string;
  loadingBackendIds?: Set<string>;
  onSelect: (backendId: string) => void;
}) {
  const enabledBackends = backends.filter((backend) => backend.enabled);
  const allBusy = enabledBackends.some(
    (backend) => summaries[backend.id]?.busy,
  );
  const allApprovalCount = enabledBackends.reduce(
    (total, backend) => total + (summaries[backend.id]?.approvalCount ?? 0),
    0,
  );
  return (
    <nav className="backend-switcher" aria-label="设备">
      <button
        type="button"
        className="backend-pill all-backends"
        aria-label={`全部设备${allBusy ? "，存在进行中任务" : ""}`}
        aria-pressed={selectedBackendId === "all"}
        onClick={() => onSelect("all")}
      >
        <strong>全部</strong>
        {allBusy && <i className="backend-busy" aria-hidden="true" />}
        {!!allApprovalCount && (
          <b className="backend-approval-count">{allApprovalCount}</b>
        )}
      </button>
      {enabledBackends.map((backend) => {
        const summary = summaries[backend.id];
        const status = summary?.connection ?? "connecting";
        const loading = loadingBackendIds.has(backend.id);
        const details = [
          statusLabel(summary),
          loading ? "正在加载会话" : "",
          summary?.busy ? "进行中" : "",
          summary?.approvalCount
            ? `${summary.approvalCount} 个待审批`
            : "",
        ].filter(Boolean).join("，");
        return (
          <button
            type="button"
            className="backend-pill"
            aria-label={`${backend.name}，${details}`}
            aria-pressed={backend.id === selectedBackendId}
            key={backend.id}
            onClick={() => onSelect(backend.id)}
          >
            {loading ? (
              <i
                className="action-spinner backend-loading"
                aria-label="正在加载机器会话"
              />
            ) : (
              <i className={`status-dot ${status}`} />
            )}
            <strong>{backend.name}</strong>
            {summary?.busy && (
              <i className="backend-busy" aria-hidden="true" />
            )}
            {!!summary?.approvalCount && (
              <b className="backend-approval-count">
                {summary.approvalCount}
              </b>
            )}
          </button>
        );
      })}
    </nav>
  );
}

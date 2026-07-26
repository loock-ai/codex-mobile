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
  onSelect,
  onManage,
}: {
  backends: BackendConfig[];
  summaries: Record<string, BackendRuntimeSummary>;
  selectedBackendId: string;
  onSelect: (backendId: string) => void;
  onManage: () => void;
}) {
  return (
    <nav className="backend-switcher" aria-label="设备">
      {backends.filter((backend) => backend.enabled).map((backend) => {
        const summary = summaries[backend.id];
        const status = summary?.connection ?? "connecting";
        const details = [
          statusLabel(summary),
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
            <i className={`status-dot ${status}`} />
            <span aria-hidden="true">▰</span>
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
      <button
        type="button"
        className="backend-add"
        aria-label="添加或管理设备"
        onClick={onManage}
      >
        ＋
      </button>
    </nav>
  );
}

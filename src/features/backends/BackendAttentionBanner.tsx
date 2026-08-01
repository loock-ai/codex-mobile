import type {
  BackendConfig,
  BackendRuntimeSummary,
} from "../../backends/types";
import { t } from "../../i18n";

export function BackendAttentionBanner({
  backends,
  summaries,
  selectedBackendId,
  onSelect,
}: {
  backends: BackendConfig[];
  summaries: Record<string, BackendRuntimeSummary>;
  selectedBackendId: string;
  onSelect: (backendId: string) => void;
}) {
  const source = backends.find(
    (backend) =>
      backend.enabled &&
      backend.id !== selectedBackendId &&
      (summaries[backend.id]?.approvalCount ?? 0) > 0,
  );
  if (!source) return null;
  const count = summaries[source.id]!.approvalCount;
  return (
    <button
      type="button"
      className="backend-attention"
      aria-label={t("{name} 有 {count} 个待审批", {
        name: source.name,
        count,
      })}
      onClick={() => onSelect(source.id)}
    >
      <span>{source.name}</span>
      <strong>{t("{count} 个待审批", { count })}</strong>
    </button>
  );
}

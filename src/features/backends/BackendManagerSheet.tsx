import {
  type FormEvent,
  useEffect,
  useState,
} from "react";
import {
  formatBackendGatewayUrl,
  moveBackend,
  parseBackendGatewayUrl,
  removeBackend,
  setBackendEnabled,
  upsertBackend,
} from "../../backends/registry";
import {
  probeBackend as defaultProbeBackend,
  type GatewayHostInfo,
} from "../../backends/probe";
import type {
  BackendConfig,
  BackendRegistry,
  BackendRuntimeSummary,
} from "../../backends/types";

interface BackendDraft {
  id: string;
  name: string;
  gatewayUrl: string;
  enabled: boolean;
  order: number;
}

function newBackendDraft(order: number): BackendDraft {
  return {
    id: `backend-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: "",
    gatewayUrl: "http://",
    enabled: true,
    order,
  };
}

export function BackendManagerSheet({
  open,
  registry,
  summaries,
  onChange,
  onClose,
  probe = defaultProbeBackend,
}: {
  open: boolean;
  registry: BackendRegistry;
  summaries: Record<string, BackendRuntimeSummary>;
  onChange: (registry: BackendRegistry) => void;
  onClose: () => void;
  probe?: (backend: BackendConfig) => Promise<GatewayHostInfo>;
}) {
  const [draft, setDraft] = useState<BackendDraft | null>(() =>
    open && !registry.backends.length ? newBackendDraft(0) : null,
  );
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) {
      setDraft(null);
      setError("");
      setTesting(false);
    } else if (!registry.backends.length) {
      setDraft((current) => current ?? newBackendDraft(0));
    }
  }, [open, registry.backends.length]);

  if (!open) return null;

  const updateRegistry = (action: () => BackendRegistry) => {
    try {
      setError("");
      onChange(action());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft || testing) return;
    setTesting(true);
    setError("");
    try {
      const gateway = parseBackendGatewayUrl(draft.gatewayUrl);
      const candidate: BackendConfig = {
        id: draft.id,
        name: draft.name.trim(),
        baseUrl: gateway.baseUrl,
        token: gateway.token,
        enabled: draft.enabled,
        order: draft.order,
      };
      const host = await probe(candidate);
      const hostId = host.hostId.trim();
      if (!hostId) throw new Error("设备身份响应无效");
      const next = upsertBackend(registry, {
        ...candidate,
        hostId,
        name: candidate.name || host.displayName,
      });
      onChange(next);
      setDraft(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setTesting(false);
    }
  };

  const deleteBackend = (backend: BackendConfig) => {
    const summary = summaries[backend.id];
    if (
      (summary?.busy || summary?.approvalCount) &&
      !window.confirm(
        `${backend.name} 仍有运行任务或待审批请求，确定删除吗？`,
      )
    ) {
      return;
    }
    updateRegistry(() => removeBackend(registry, backend.id));
  };

  return (
    <div className="backend-manager-backdrop" role="presentation">
      <section
        className="backend-manager-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="backend-manager-title"
      >
        <header>
          <h2 id="backend-manager-title">
            {draft ? "设备连接" : "管理设备"}
          </h2>
          <button type="button" aria-label="关闭" onClick={onClose}>×</button>
        </header>
        {draft ? (
          <form className="backend-form" onSubmit={submit}>
            <label>
              <span>设备名称</span>
              <input
                aria-label="设备名称"
                value={draft.name}
                placeholder="例如 Mac mini"
                onChange={(event) =>
                  setDraft({ ...draft, name: event.target.value })
                }
              />
            </label>
            <label>
              <span>网关地址</span>
              <input
                aria-label="网关地址"
                inputMode="url"
                value={draft.gatewayUrl}
                placeholder="http://host.local:4173/?token=xxx"
                onChange={(event) =>
                  setDraft({ ...draft, gatewayUrl: event.target.value })
                }
              />
            </label>
            {error && <p className="backend-form-error" role="alert">{error}</p>}
            <div className="backend-form-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setDraft(null);
                  setError("");
                }}
              >
                取消
              </button>
              <button type="submit" disabled={testing}>
                {testing ? "正在测试…" : "测试并保存"}
              </button>
            </div>
          </form>
        ) : (
          <>
            <div className="backend-manager-list">
              {registry.backends.map((backend, index) => {
                const summary = summaries[backend.id];
                return (
                  <article className="backend-manager-row" key={backend.id}>
                    <div>
                      <i
                        className={`status-dot ${
                          summary?.connection ?? "offline"
                        }`}
                      />
                      <strong>{backend.name}</strong>
                      <small>{backend.baseUrl}</small>
                      <span>
                        {!backend.enabled
                          ? "已暂停"
                          : summary?.busy
                            ? "任务进行中"
                            : summary?.approvalCount
                              ? `${summary.approvalCount} 个待审批`
                              : summary?.connection === "online"
                                ? "已连接"
                                : "未连接"}
                      </span>
                    </div>
                    <div className="backend-row-actions">
                      <button
                        type="button"
                        aria-label={`上移 ${backend.name}`}
                        disabled={index === 0}
                        onClick={() =>
                          updateRegistry(() =>
                            moveBackend(registry, backend.id, -1),
                          )
                        }
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        aria-label={`下移 ${backend.name}`}
                        disabled={index === registry.backends.length - 1}
                        onClick={() =>
                          updateRegistry(() =>
                            moveBackend(registry, backend.id, 1),
                          )
                        }
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        aria-label={`编辑 ${backend.name}`}
                        onClick={() => {
                          setDraft({
                            id: backend.id,
                            name: backend.name,
                            gatewayUrl: formatBackendGatewayUrl(
                              backend.baseUrl,
                              backend.token,
                            ),
                            enabled: backend.enabled,
                            order: backend.order,
                          });
                          setError("");
                        }}
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        aria-label={`${backend.enabled ? "暂停" : "启用"} ${backend.name}`}
                        onClick={() =>
                          updateRegistry(() =>
                            setBackendEnabled(
                              registry,
                              backend.id,
                              !backend.enabled,
                            ),
                          )
                        }
                      >
                        {backend.enabled ? "暂停" : "启用"}
                      </button>
                      <button
                        type="button"
                        aria-label={`删除 ${backend.name}`}
                        onClick={() => deleteBackend(backend)}
                      >
                        删除
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
            {error && <p className="backend-form-error" role="alert">{error}</p>}
            <button
              type="button"
              className="backend-add-device"
              aria-label="添加设备"
              onClick={() => {
                setDraft(newBackendDraft(registry.backends.length));
                setError("");
              }}
            >
              ＋ 添加设备
            </button>
          </>
        )}
      </section>
    </div>
  );
}

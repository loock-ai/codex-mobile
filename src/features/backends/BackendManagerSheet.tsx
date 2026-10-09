import {
  type FormEvent,
  useCallback,
  useEffect,
  useState,
  useRef,
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
import { ActionSheet } from "../../ui/ActionSheet";
import { t, useI18n } from "../../i18n";
import { GatewayQrScannerSheet } from "./GatewayQrScannerSheet";

import {fetchDesktopHosts} from "../../backends/desktop-hosts";
import {displayedHostIds} from "../../backends/host-selection";
import type {DesktopHost} from "../../backends/types";

function HostChoices({hosts,selected,onToggle,disabled=false}: {hosts:DesktopHost[];selected:string[];onToggle:(id:string)=>void;disabled?:boolean}) {
 return <div className="backend-host-choices">{hosts.map(host=>{const name=host.hostId==='local'&&host.displayName!==t("本机")?t("{name}（本机）",{name:host.displayName}):host.displayName;return <label className="backend-host-choice" key={host.hostId}>
  <span className="backend-host-identity"><strong>{name}</strong><small>{host.hostId}</small></span>
  <span className="backend-host-toggle">{t("显示")}<input type="checkbox" aria-label={t("显示 {name}",{name})} checked={selected.includes(host.hostId)} disabled={disabled} onChange={()=>onToggle(host.hostId)}/></span>
 </label>;})}</div>;
}

function toggleHost(ids:string[],id:string) {return ids.includes(id)?ids.filter(value=>value!==id):[...ids,id];}

interface BackendDraft {
  desktopHosts?: DesktopHost[];
  visibleHostIds?: string[];
  remoteProjects?: boolean;
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
    gatewayUrl: "",
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
  appUpdate,
  probe = defaultProbeBackend,
  scanQrCode,
  discoverHosts = fetchDesktopHosts,
}: {
  open: boolean;
  registry: BackendRegistry;
  summaries: Record<string, BackendRuntimeSummary>;
  onChange: (registry: BackendRegistry) => void;
  onClose: () => void;
  appUpdate?: {
    supported: boolean;
    currentVersion: string;
    checking: boolean;
    status?: string;
    onCheck: () => void;
  };
  probe?: (backend: BackendConfig) => Promise<GatewayHostInfo>;
  scanQrCode?: () => Promise<string>;
  discoverHosts?: (backend:BackendConfig)=>Promise<DesktopHost[]|null>;
}) {
  const { preference, setPreference } = useI18n();
  const [draft, setDraft] = useState<BackendDraft | null>(() =>
    open && !registry.backends.length ? newBackendDraft(0) : null,
  );
  const [testing, setTesting] = useState(false);
  const [selection,setSelection]=useState<{candidate:BackendConfig;hosts:DesktopHost[];ids:string[]}|null>(null);
  const attempt=useRef(0);
  const registryRef=useRef(registry);registryRef.current=registry;
  const [error, setError] = useState("");
  const [qrScannerOpen, setQrScannerOpen] = useState(false);
  useEffect(()=>()=>{attempt.current++;},[]);

  useEffect(() => {
    if (!open) {
      attempt.current++;
      setSelection(null);
      setDraft(null);
      setError("");
      setTesting(false);
      setQrScannerOpen(false);
    } else if (!registry.backends.length) {
      setDraft((current) => current ?? newBackendDraft(0));
    }
  }, [open, registry.backends.length]);

  const applyScannedGateway = useCallback((value: string) => {
    try {
      const gateway = parseBackendGatewayUrl(value);
      if (!gateway.token) throw new Error(t("二维码中缺少访问口令"));
      setDraft((current) =>
        current
          ? {
              ...current,
              gatewayUrl: formatBackendGatewayUrl(
                gateway.baseUrl,
                gateway.token,
              ),
            }
          : current,
      );
      setError("");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? t("二维码无效：{message}", { message: reason.message })
          : t("二维码不是有效的网关链接"),
      );
    } finally {
      setQrScannerOpen(false);
    }
  }, []);

  const openQrScanner = async () => {
    if (!scanQrCode) {
      setQrScannerOpen(true);
      return;
    }
    try {
      applyScannedGateway(await scanQrCode());
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t("未能识别二维码"),
      );
    }
  };

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
    const sequence=++attempt.current;
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
        ...(draft.remoteProjects?{remoteProjects:true}:{}),
        desktopHosts:draft.desktopHosts,
        visibleHostIds:draft.visibleHostIds,
      };
      const host = await probe(candidate);
      if(sequence!==attempt.current)return;
      const hostId = host.hostId.trim();
      if (!hostId) throw new Error(t("设备身份响应无效"));
      const tested={...candidate,hostId,name:candidate.name || host.displayName};
      if(host.backend === "desktop-control") {
        const hosts=await discoverHosts(tested);
        if(sequence!==attempt.current)return;
        if(!hosts)throw new Error(t("此设备暂不支持远程项目"));
        // 地址变更视为新连接；不把上一台机器的选择套到另一台机器。
        const previous=registryRef.current.backends.find(b=>b.id===tested.id);
        const sameGateway=previous?.baseUrl===tested.baseUrl && (!previous?.hostId||previous.hostId===tested.hostId);
        const ids=displayedHostIds(sameGateway?previous!:{},hosts);
        setSelection({candidate:tested,hosts,ids:[...ids]});
      } else {
        if(sequence!==attempt.current)return;
        const {desktopHosts:_,visibleHostIds:__,remoteProjects:___,...plain}=tested;
        onChange(upsertBackend(registryRef.current,plain));setDraft(null);
      }
    } catch (reason) {
      if(sequence===attempt.current)setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if(sequence===attempt.current)setTesting(false);
    }
  };

  const deleteBackend = (backend: BackendConfig) => {
    const summary = summaries[backend.id];
    if (
      (summary?.busy || summary?.approvalCount) &&
      !window.confirm(
        t("{name} 仍有运行任务或待审批请求，确定删除吗？", {
          name: backend.name,
        }),
      )
    ) {
      return;
    }
    updateRegistry(() => removeBackend(registry, backend.id));
  };

  return (
    <>
      <ActionSheet
        title={selection ? t("选择展示的主机") : draft ? t("设备连接") : t("管理设备")}
        onClose={()=>{attempt.current++;setSelection(null);onClose();}}
        closeLabel={t("关闭")}
        closeOnBackdrop={false}
        className="backend-manager-sheet"
        backdropClassName="backend-manager-backdrop"
      >
        {selection ? <div className="backend-host-picker">
          <p>{t("检测到 {count} 个主机，请选择需要展示的项目和会话。",{count:selection.hosts.length})}</p>
          <HostChoices hosts={selection.hosts} selected={selection.ids} onToggle={id=>setSelection({...selection,ids:toggleHost(selection.ids,id)})}/>
          {error && <p className="backend-form-error" role="alert">{error}</p>}
          <div className="backend-form-actions">
            <button type="button" className="secondary" onClick={()=>{setSelection(null);setError("");}}>{t("取消")}</button>
            <button type="button" onClick={()=>{
              try{onChange(upsertBackend(registryRef.current,{...selection.candidate,remoteProjects:false,desktopHosts:selection.hosts,visibleHostIds:selection.ids}));setSelection(null);setDraft(null);setError("");}
              catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
            }}>{t("保存选择")}</button>
          </div>
        </div> : draft ? (
          <form className="backend-form" onSubmit={submit}>
            <label>
              <span>{t("设备名称")}</span>
              <input
                aria-label={t("设备名称")}
                disabled={testing}
                value={draft.name}
                placeholder={t("例如 Mac mini")}
                onChange={(event) =>
                  setDraft({ ...draft, name: event.target.value })
                }
              />
            </label>
            <div className="backend-form-field">
              <label htmlFor="backend-gateway-url">{t("网关地址")}</label>
              <div className="backend-gateway-input">
                <input
                  id="backend-gateway-url"
                  aria-label={t("网关地址")}
                  inputMode="url"
                  disabled={testing}
                  value={draft.gatewayUrl}
                  placeholder="http://host.local:18766/?token=xxx"
                  onChange={(event) =>
                    setDraft({ ...draft, gatewayUrl: event.target.value })
                  }
                />
                <button
                  type="button"
                  aria-label={t("扫描网关二维码")}
                  disabled={testing}
                  onClick={() => void openQrScanner()}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4" />
                    <path d="M8 8h3v3H8zM14 8h2M14 11h2M8 14h2M13 14h3v3h-3z" />
                  </svg>
                </button>
              </div>
            </div>
            {error && <p className="backend-form-error" role="alert">{error}</p>}
            <div className="backend-form-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  attempt.current++;setTesting(false);
                  setDraft(null);
                  setError("");
                }}
              >
                {t("取消")}
              </button>
              <button type="submit" disabled={testing}>
                {testing ? t("正在测试…") : t("测试并保存")}
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
                          ? t("已暂停")
                          : summary?.busy
                            ? t("任务进行中")
                            : summary?.approvalCount
                              ? t("{count} 个待审批", {
                                  count: summary.approvalCount,
                                })
                              : summary?.connection === "online"
                                ? t("已连接")
                                : t("未连接")}
                      </span>
                    </div>
                    <div className="backend-row-actions">
                      <button
                        type="button"
                        aria-label={t("上移 {name}", { name: backend.name })}
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
                        aria-label={t("下移 {name}", { name: backend.name })}
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
                        aria-label={t("编辑 {name}", { name: backend.name })}
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
                            remoteProjects: backend.remoteProjects,
                            desktopHosts:backend.desktopHosts,
                            visibleHostIds:backend.visibleHostIds,
                          });
                          setError("");
                        }}
                      >
                        {t("编辑")}
                      </button>
                      <button
                        type="button"
                        aria-label={t(
                          backend.enabled ? "暂停 {name}" : "启用 {name}",
                          { name: backend.name },
                        )}
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
                        {backend.enabled ? t("暂停") : t("启用")}
                      </button>
                      <button
                        type="button"
                        aria-label={t("删除 {name}", { name: backend.name })}
                        onClick={() => deleteBackend(backend)}
                      >
                        {t("删除")}
                      </button>
                    </div>
                    {backend.desktopHosts && <details className="backend-host-tree" open>
                      <summary>{t("主机（{count}）",{count:backend.desktopHosts.length})}</summary>
                      <HostChoices hosts={backend.desktopHosts} selected={displayedHostIds(backend,backend.desktopHosts)} onToggle={id=>updateRegistry(()=>upsertBackend(registry,{...backend,remoteProjects:false,visibleHostIds:toggleHost(displayedHostIds(backend,backend.desktopHosts!),id)}))}/>
                    </details>}
                  </article>
                );
              })}
            </div>
            {error && <p className="backend-form-error" role="alert">{error}</p>}
            <button
              type="button"
              className="backend-add-device"
              aria-label={t("添加设备")}
              onClick={() => {
                setDraft(newBackendDraft(registry.backends.length));
                setError("");
              }}
            >
              ＋ {t("添加设备")}
            </button>
            <section className="backend-language-settings" aria-label={t("语言")}>
              <strong>{t("语言")}</strong>
              <div role="group" aria-label={t("语言")}>
                {([
                  ["system", "跟随系统"],
                  ["zh-CN", "中文"],
                  ["en", "英文"],
                ] as const).map(([value, label]) => (
                  <button
                    type="button"
                    key={value}
                    className={preference === value ? "selected" : ""}
                    aria-pressed={preference === value}
                    onClick={() => setPreference(value)}
                  >
                    {t(label)}
                  </button>
                ))}
              </div>
            </section>
            {appUpdate?.supported && (
              <section className="backend-app-update" aria-label={t("应用更新")}>
                <div>
                  <strong>Codex Mobile</strong>
                  <small>{t("当前版本 v{version}", { version: appUpdate.currentVersion })}</small>
                  {appUpdate.status && <small>{appUpdate.status}</small>}
                </div>
                <button
                  type="button"
                  disabled={appUpdate.checking}
                  onClick={appUpdate.onCheck}
                >
                  {appUpdate.checking ? t("正在检查…") : t("检查更新")}
                </button>
              </section>
            )}
          </>
        )}
      </ActionSheet>
      <GatewayQrScannerSheet
        open={qrScannerOpen}
        onScan={applyScannedGateway}
        onClose={() => setQrScannerOpen(false)}
      />
    </>
  );
}

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppServerClient, type RpcMessage } from "./app-server/client";
import { createLatestThreadListLoader } from "./app-server/thread-list-loader";
import {
  applyCompletedTurn,
  applyFileChangePatch,
  applyTurnDiff,
  applyTurnItem,
  applyTurnStarted,
  isThreadRunning,
  removePendingTurn,
} from "./ui/conversation";
import { resumeThreadSession } from "./app-server/thread-session";
import {
  ConversationPage,
  type ConversationLoadState,
} from "./features/conversation/ConversationPage";
import { ThreadListPage } from "./features/threads/ThreadListPage";
import { ApprovalSheet } from "./features/approvals/ApprovalSheet";
import {
  ComposerSettings,
  type ComposerPicker,
} from "./features/settings/ComposerSettings";
import {
  titleOf,
  type ConnectionState,
  type ThreadListState,
} from "./ui/app-display";
import {
  ImageReadGeneration,
  buildOptimisticUserContent,
  buildTurnInput,
  mergeDraftImages,
  prepareImageFiles,
  type DraftImage,
} from "./ui/attachments";
import {
  effortOptionsForModel,
  normalizeModelSettings,
  permissionModeFromSettings,
  permissionModesFromProfiles,
  permissionProfileLabel,
  speedOptionsForModel,
  type ApprovalPolicy,
  type ApprovalsReviewer,
  type PermissionModeId,
} from "./ui/settings";
import {
  assignBackendHostId,
  loadBackendRegistry,
  saveBackendRegistry,
} from "./backends/registry";
import { BackendConnectionManager } from "./backends/connection-manager";
import { fetchBackendHostInfo } from "./backends/probe";
import type {
  BackendConfig,
  BackendRegistry,
  BackendRuntimeSummary,
} from "./backends/types";
import { BackendManagerSheet } from "./features/backends/BackendManagerSheet";
import { BackendAttentionBanner } from "./features/backends/BackendAttentionBanner";

type AnyRecord = Record<string, any>;

interface BackendWorkspaceProps {
  backend: BackendConfig;
  visible: boolean;
  backends: BackendConfig[];
  summaries: Record<string, BackendRuntimeSummary>;
  onSelectBackend: (backendId: string) => void;
  onManageBackends: () => void;
  onSummaryChange: (summary: BackendRuntimeSummary) => void;
}

function BackendWorkspace({
  backend,
  visible,
  backends,
  summaries,
  onSelectBackend,
  onManageBackends,
  onSummaryChange,
}: BackendWorkspaceProps) {
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
  const [conversationLoadState, setConversationLoadState] =
    useState<ConversationLoadState>("idle");
  const [conversationLoadError, setConversationLoadError] = useState("");
  const [picker, setPicker] = useState<ComposerPicker>(null);
  const clientRef = useRef<AppServerClient | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const imageReadGenerationRef = useRef(new ImageReadGeneration());
  const draftContextGenerationRef = useRef(0);
  const activeRef = useRef<AnyRecord | null>(null);
  const activeThreadTargetRef = useRef<string | null>(null);
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
    if (!visible) return;
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
  }, [active?.id, conversationLoadState, visible]);

  useEffect(() => {
    const hasRunningThread = threads.some((thread) =>
      isThreadRunning(thread.status),
    );
    onSummaryChange({
      backendId: backend.id,
      connection,
      busy: busy || hasRunningThread,
      approvalCount: requests.length,
      error,
    });
  }, [
    backend.id,
    busy,
    connection,
    error,
    onSummaryChange,
    requests.length,
    threads,
  ]);

  useEffect(() => {
    const refresh = window.setInterval(() => {
      setListNow(Math.floor(Date.now() / 1000));
      void loadThreads().catch(() => undefined);
    }, 60_000);
    return () => window.clearInterval(refresh);
  }, []);

  useEffect(() => {
    let disposed = false;
    let manager: BackendConnectionManager;
    manager = new BackendConnectionManager({
      onConnection: (_backendId, status, connectionError) => {
        if (disposed) return;
        setConnection(status);
        if (status === "online") setError("");
        if (connectionError) setError(connectionError);
        if (status === "offline") {
          clientRef.current = null;
          setBusy(false);
          setRequests([]);
          void fetchBackendHostInfo(backend).catch((reason) => {
            const message =
              reason instanceof Error ? reason.message : String(reason);
            if (
              message.includes("访问口令") ||
              message.includes("未被设备允许")
            ) {
              manager.sync([]);
              setError(message);
            }
          });
        }
      },
      onNotification: (_backendId, message, source) => {
          const client = source as AppServerClient;
          const params = (message.params ?? {}) as AnyRecord;
          if (message.method === "turn/started" && params.turn) {
            if (params.threadId) {
              setThreads((current) => {
                const index = current.findIndex(
                  (thread) => thread.id === params.threadId,
                );
                if (index >= 0) {
                  return current.map((thread, threadIndex) =>
                    threadIndex === index
                      ? { ...thread, status: { type: "active" } }
                      : thread,
                  );
                }
                const opened = activeRef.current;
                return opened?.id === params.threadId
                  ? [{ ...opened, status: { type: "active" } }, ...current]
                  : current;
              });
            }
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
            if (params.threadId) {
              setThreads((current) =>
                current.map((thread) =>
                  thread.id === params.threadId
                    ? { ...thread, status: { type: "idle" } }
                    : thread,
                ),
              );
            }
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
            message.method === "thread/status/changed" &&
            params.threadId &&
            params.status
          ) {
            setThreads((current) =>
              current.map((thread) =>
                thread.id === params.threadId
                  ? { ...thread, status: params.status }
                  : thread,
              ),
            );
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
      },
      onRequest: (_backendId, request, source) => {
          const client = source as AppServerClient;
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
      },
      onReady: (_backendId, source) => {
        const client = source as AppServerClient;
        clientRef.current = client;
        void (async () => {
          try {
            if (!disposed && manager.client(backend.id) === source) {
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
            if (disposed || manager.client(backend.id) !== source) return;
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
              activeThreadTargetRef.current = currentThread.id;
              const resumed = await resumeThreadSession(client, currentThread.id);
              if (
                !disposed &&
                manager.client(backend.id) === source &&
                activeRef.current?.id === currentThread.id
              ) {
                const resumedSettings = normalizeModelSettings(
                  modelResult.data.find(
                    (model) => model.model === resumed.model,
                  ),
                  resumed.reasoningEffort,
                  resumed.serviceTier,
                );
                setActive(resumed.thread);
                setConversationLoadState("ready");
                setConversationLoadError("");
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
            if (!disposed) {
              setError(
                reason instanceof Error ? reason.message : String(reason),
              );
              if (manager.client(backend.id) === source) {
                manager.socket(backend.id)?.close(
                  1011,
                  "workspace initialization failed",
                );
              }
            }
          }
        })();
      },
    });
    manager.sync([backend]);
    return () => {
      disposed = true;
      manager.close();
      clientRef.current = null;
    };
  }, [backend.baseUrl, backend.id, backend.token]);

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

  async function loadThreadDetail(threadId: string, sequence: number) {
    const client = clientRef.current;
    try {
      if (!client) throw new Error("设备尚未连接，请稍后重试");
      const session = await resumeThreadSession(client, threadId);
      if (sequence !== openSequenceRef.current) {
        if (activeThreadTargetRef.current !== threadId) {
          void client
            .request("thread/unsubscribe", { threadId })
            .catch(() => undefined);
        }
        return;
      }
      if (!session.thread?.id) {
        throw new Error("会话详情返回无效，请重试");
      }
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
      setConversationLoadState("ready");
      setConversationLoadError("");
      const lastTurn = session.thread.turns?.at(-1);
      setBusy(
        ["inProgress", "in_progress", "running"].includes(lastTurn?.status),
      );

      if (session.thread.cwd) {
        void client
          .request<{ data: AnyRecord[] }>("permissionProfile/list", {
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
        setBusy(false);
        setConversationLoadState("error");
        setConversationLoadError(
          reason instanceof Error ? reason.message : String(reason),
        );
      }
    } finally {
      if (sequence === openSequenceRef.current) setOpeningThreadId("");
    }
  }

  function openThread(thread: AnyRecord) {
    const sequence = ++openSequenceRef.current;
    resetDraftContext();
    setDraft("");
    setDraftImages([]);
    setOpeningThreadId(thread.id);
    setError("");
    setBusy(false);
    setConversationLoadError("");
    setConversationLoadState("loading");
    activeThreadTargetRef.current = thread.id;
    setActive({
      ...thread,
      turns: thread.turns ?? [],
    });
    void loadThreadDetail(thread.id, sequence);
  }

  function retryThreadDetail() {
    const threadId = activeRef.current?.id;
    if (!threadId) return;
    const sequence = ++openSequenceRef.current;
    activeThreadTargetRef.current = threadId;
    setOpeningThreadId(threadId);
    setConversationLoadError("");
    setConversationLoadState("loading");
    void loadThreadDetail(threadId, sequence);
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
        activeThreadTargetRef.current = thread.id;
        setThreads((current) => [
          { ...thread!, status: { type: "active" } },
          ...current.filter((entry) => entry.id !== thread!.id),
        ]);
        const startedModel = started.model || selectedModel;
        const startedSettings = normalizeModelSettings(
          models.find((model) => model.model === startedModel),
          started.reasoningEffort ?? selectedEffort,
          started.serviceTier ?? selectedServiceTier,
        );
        if (draftContext === draftContextGenerationRef.current) {
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
      }
      const localItem = {
        id: `local-${pendingTurnId}`,
        type: "userMessage",
        content: buildOptimisticUserContent(text, pendingImages),
      };
      if (draftContext === draftContextGenerationRef.current) {
        setActive((current) => {
          if (!current || current.id !== thread!.id) return current;
          return {
            ...current,
            turns: [
              ...(current.turns ?? thread!.turns ?? []),
              {
                id: pendingTurnId,
                status: "inProgress",
                items: [localItem],
              },
            ],
          };
        });
      }
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
      if (draftContext === draftContextGenerationRef.current) {
        setActive((current) => {
          if (!current) return current;
          return applyTurnStarted(current, {
            threadId: thread!.id,
            turn: startedTurn.turn,
          });
        });
      }
    } catch (reason) {
      if (thread?.id) {
        setThreads((current) =>
          current.map((entry) =>
            entry.id === thread!.id
              ? { ...entry, status: { type: "idle" } }
              : entry,
          ),
        );
        void loadThreads().catch(() => undefined);
      }
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

  const leaveConversation = () => {
    if (!active) return;
    openSequenceRef.current += 1;
    activeThreadTargetRef.current = null;
    resetDraftContext();
    const threadId = active.id;
    setOpeningThreadId("");
    setDraft("");
    setDraftImages([]);
    setConversationLoadState("idle");
    setConversationLoadError("");
    setActive(null);
    setBusy(false);
    if (threadId && !busy) {
      void clientRef.current
        ?.request("thread/unsubscribe", { threadId })
        .catch(() => undefined);
    }
  };

  const startNewChat = () => {
    openSequenceRef.current += 1;
    activeThreadTargetRef.current = null;
    resetDraftContext();
    setOpeningThreadId("");
    setDraft("");
    setDraftImages([]);
    setConversationLoadState("ready");
    setConversationLoadError("");
    setActiveSettingsSynchronized(true);
    setActive({ id: "", turns: [], preview: "新对话" });
  };

  return (
    <main className="app-shell">
      {active ? (
        <ConversationPage
          active={active}
          loadState={conversationLoadState}
          loadError={conversationLoadError}
          connection={connection}
          client={clientRef.current}
          error={error}
          draft={draft}
          draftImages={draftImages}
          imageReading={imageReading}
          busy={busy}
          selectedServiceTier={selectedServiceTier}
          selectedModelLabel={selectedModelLabel}
          selectedEffort={selectedEffort}
          selectedPermissionLabel={selectedPermissionLabel}
          imageInputRef={imageInputRef}
          onBack={leaveConversation}
          onRetry={retryThreadDetail}
          onSubmit={send}
          onRemoveImage={(imageId) =>
            setDraftImages((current) =>
              current.filter((entry) => entry.id !== imageId),
            )
          }
          onSelectImages={selectImages}
          onOpenAgentSettings={() => setPicker("agent")}
          onOpenPermissionSettings={() => setPicker("permission")}
          onDraftChange={setDraft}
          onInterrupt={interrupt}
        />
      ) : (
        <ThreadListPage
          connection={connection}
          hostname={new URL(backend.baseUrl).hostname}
          backends={backends}
          summaries={summaries}
          selectedBackendId={backend.id}
          threadListState={threadListState}
          visibleThreads={visibleThreads}
          totalThreadCount={threads.length}
          openingThreadId={openingThreadId}
          query={query}
          listNow={listNow}
          error={error}
          onQueryChange={setQuery}
          onOpenThread={openThread}
          onNewChat={startNewChat}
          onSelectBackend={onSelectBackend}
          onManageBackends={onManageBackends}
        />
      )}
      <ApprovalSheet
        approval={approval}
        userAnswers={userAnswers}
        onAnswerChange={(questionId, value) =>
          setUserAnswers((current) => ({
            ...current,
            [questionId]: value,
          }))
        }
        onSubmitAnswers={answerQuestions}
        onDecision={finishRequest}
      />
      <ComposerSettings
        picker={picker}
        effortOptions={effortOptions}
        speedOptions={speedOptions}
        permissionModes={permissionModes}
        models={models}
        selectedEffort={selectedEffort}
        selectedModel={selectedModel}
        selectedModelLabel={selectedModelLabel}
        selectedServiceTier={selectedServiceTier}
        selectedSpeedLabel={selectedSpeedLabel}
        selectedPermissionModeId={selectedPermissionModeId}
        onPickerChange={setPicker}
        onChooseEffort={setSelectedEffort}
        onChooseModel={chooseModel}
        onChooseSpeed={setSelectedServiceTier}
        onChoosePermissionMode={choosePermissionMode}
      />
    </main>
  );
}

export function App() {
  const [registry, setRegistry] = useState<BackendRegistry>(() => {
    const token = new URLSearchParams(window.location.search).get("token") ?? "";
    const initial = loadBackendRegistry(
      window.localStorage,
      window.location.origin,
      token,
    );
    saveBackendRegistry(window.localStorage, initial);
    return initial;
  });
  const [summaries, setSummaries] = useState<
    Record<string, BackendRuntimeSummary>
  >({});
  const [managerOpen, setManagerOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    for (const backend of registry.backends) {
      if (!backend.enabled || backend.hostId) continue;
      void fetchBackendHostInfo(backend)
        .then((host) => {
          if (cancelled || !host.hostId.trim()) return;
          setRegistry((current) => {
            const target = current.backends.find(
              (entry) => entry.id === backend.id,
            );
            if (
              !target ||
              target.hostId ||
              target.baseUrl !== backend.baseUrl
            ) {
              return current;
            }
            const next = assignBackendHostId(
              current,
              backend.id,
              host.hostId,
            );
            if (next === current) return current;
            saveBackendRegistry(window.localStorage, next);
            return next;
          });
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [registry.backends]);

  const enabledBackends = registry.backends.filter(
    (backend) => backend.enabled,
  );
  const mountedBackends = enabledBackends.length
    ? enabledBackends
    : registry.backends.slice(0, 1);
  const selectedBackend =
    mountedBackends.find(
      (backend) => backend.id === registry.selectedBackendId,
    ) ?? mountedBackends[0];

  const persistRegistry = useCallback((next: BackendRegistry) => {
    saveBackendRegistry(window.localStorage, next);
    setRegistry(
      loadBackendRegistry(window.localStorage, window.location.origin),
    );
  }, []);

  const selectBackend = useCallback((backendId: string) => {
    setRegistry((current) => {
      const target = current.backends.find(
        (backend) => backend.id === backendId && backend.enabled,
      );
      if (!target || current.selectedBackendId === backendId) return current;
      const next = { ...current, selectedBackendId: backendId };
      saveBackendRegistry(window.localStorage, next);
      return next;
    });
  }, []);

  const updateSummary = useCallback((summary: BackendRuntimeSummary) => {
    setSummaries((current) => {
      const previous = current[summary.backendId];
      if (
        previous &&
        previous.connection === summary.connection &&
        previous.busy === summary.busy &&
        previous.approvalCount === summary.approvalCount &&
        previous.error === summary.error
      ) {
        return current;
      }
      return { ...current, [summary.backendId]: summary };
    });
  }, []);

  if (!selectedBackend) {
    return <main className="app-shell"><div className="empty-state">没有可用设备</div></main>;
  }

  return (
    <>
      {mountedBackends.map((backend) => (
        <div
          className="backend-workspace"
          hidden={backend.id !== selectedBackend.id}
          key={`${backend.id}:${backend.baseUrl}:${backend.token}`}
        >
          <BackendWorkspace
            backend={backend}
            visible={backend.id === selectedBackend.id}
            backends={registry.backends}
            summaries={summaries}
            onSelectBackend={selectBackend}
            onManageBackends={() => setManagerOpen(true)}
            onSummaryChange={updateSummary}
          />
        </div>
      ))}
      <BackendAttentionBanner
        backends={registry.backends}
        summaries={summaries}
        selectedBackendId={selectedBackend.id}
        onSelect={selectBackend}
      />
      <BackendManagerSheet
        open={managerOpen}
        registry={registry}
        summaries={summaries}
        onChange={persistRegistry}
        onClose={() => setManagerOpen(false)}
      />
    </>
  );
}

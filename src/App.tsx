import {
  FormEvent,
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
  removePendingTurn,
} from "./ui/conversation";
import { resumeThreadSession } from "./app-server/thread-session";
import { ConversationPage } from "./features/conversation/ConversationPage";
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

type AnyRecord = Record<string, any>;

function wsUrl() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const token = new URLSearchParams(location.search).get("token");
  return `${protocol}//${location.host}/ws${token ? `?token=${encodeURIComponent(token)}` : ""}`;
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
  const [picker, setPicker] = useState<ComposerPicker>(null);
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
  };

  const startNewChat = () => {
    openSequenceRef.current += 1;
    resetDraftContext();
    setOpeningThreadId("");
    setDraft("");
    setDraftImages([]);
    setActiveSettingsSynchronized(true);
    setActive({ id: "", turns: [], preview: "新对话" });
  };

  return (
    <main className="app-shell">
      {active ? (
        <ConversationPage
          active={active}
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
          hostname={location.hostname}
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

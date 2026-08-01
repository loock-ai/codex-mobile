import type { AppServerClient, RpcMessage } from "./client";
import { t } from "../i18n";

export type RealtimeStatus =
  | "idle"
  | "connecting"
  | "listening"
  | "stopping"
  | "error";

export interface RealtimeState {
  status: RealtimeStatus;
  sessionId: string | null;
  startedAt: number | null;
  userTranscript: string;
  assistantTranscript: string;
  muted: boolean;
  error: string;
}

export type RealtimeAction =
  | { type: "start"; startedAt: number }
  | { type: "started"; sessionId?: string | null }
  | { type: "stopping" }
  | { type: "mute"; muted: boolean }
  | { type: "transcript"; role: string; delta: string; final?: boolean }
  | { type: "error"; message: string }
  | { type: "closed" };

export interface RealtimeAudioChunk {
  data: string;
  sampleRate: number;
  numChannels: number;
  samplesPerChannel?: number | null;
  itemId?: string | null;
}

export const initialRealtimeState: RealtimeState = {
  status: "idle",
  sessionId: null,
  startedAt: null,
  userTranscript: "",
  assistantTranscript: "",
  muted: false,
  error: "",
};

export function realtimeUnavailableReason({
  hasGetUserMedia,
  isSecureContext,
  protocol,
  hasNativeBridge = false,
}: {
  hasGetUserMedia: boolean;
  isSecureContext: boolean;
  protocol: string;
  hasNativeBridge?: boolean;
}) {
  if (hasNativeBridge) return "";
  const localProtocol = ["file:", "capacitor:"].includes(protocol);
  if (!isSecureContext && !localProtocol) {
    return t("当前页面使用 HTTP，浏览器仅允许在 HTTPS 页面申请麦克风权限");
  }
  if (!hasGetUserMedia) {
    return t("当前环境不支持麦克风");
  }
  return "";
}

export function appendRealtimeTranscript(
  state: RealtimeState,
  role: string,
  text: string,
  final = false,
): RealtimeState {
  const key =
    role === "user" ? "userTranscript" : "assistantTranscript";
  return {
    ...state,
    [key]: final ? text : `${state[key]}${text}`,
  };
}

export function realtimeReducer(
  state: RealtimeState,
  action: RealtimeAction,
): RealtimeState {
  switch (action.type) {
    case "start":
      return {
        ...initialRealtimeState,
        status: "connecting",
        startedAt: action.startedAt,
      };
    case "started":
      return {
        ...state,
        status: "listening",
        sessionId: action.sessionId ?? null,
      };
    case "stopping":
      return { ...state, status: "stopping" };
    case "mute":
      return { ...state, muted: action.muted };
    case "transcript":
      return appendRealtimeTranscript(
        state,
        action.role,
        action.delta,
        action.final,
      );
    case "error":
      return { ...state, status: "error", error: action.message };
    case "closed":
      return initialRealtimeState;
  }
}

export function startRealtimeSession(
  client: Pick<AppServerClient, "request">,
  threadId: string,
) {
  return client.request("thread/realtime/start", {
    threadId,
    outputModality: "audio",
    version: "v3",
    voice: "cove",
    transport: { type: "websocket" },
    includeStartupContext: true,
    clientManagedHandoffs: false,
  });
}

export function appendRealtimeAudio(
  client: Pick<AppServerClient, "request">,
  threadId: string,
  audio: RealtimeAudioChunk,
) {
  return client.request(
    "thread/realtime/appendAudio",
    { threadId, audio },
    { timeoutMs: 30_000 },
  );
}

export function stopRealtimeSession(
  client: Pick<AppServerClient, "request">,
  threadId: string,
) {
  return client.request("thread/realtime/stop", { threadId });
}

export function isRealtimeNotificationForThread(
  message: RpcMessage,
  threadId: string,
) {
  if (!message.method?.startsWith("thread/realtime/")) return false;
  const params = (message.params ?? {}) as { threadId?: string };
  return params.threadId === threadId;
}

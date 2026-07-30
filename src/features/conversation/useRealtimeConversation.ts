import { useCallback, useEffect, useReducer, useRef } from "react";
import type { AppServerClient, RpcMessage } from "../../app-server/client";
import {
  appendRealtimeAudio,
  initialRealtimeState,
  isRealtimeNotificationForThread,
  realtimeUnavailableReason,
  realtimeReducer,
  startRealtimeSession,
  stopRealtimeSession,
  type RealtimeAudioChunk,
} from "../../app-server/realtime";
import {
  createRealtimeAudioCapture,
  hasNativeRealtimeAudioBridge,
  type RealtimeAudioCaptureSource,
  RealtimeAudioPlayback,
} from "../../audio/realtime-audio";
import { NATIVE_REALTIME_AUDIO_EVENT } from "../../audio/native-realtime-audio";

export function useRealtimeConversation({
  client,
  threadId,
  connectionOnline,
}: {
  client: AppServerClient | null;
  threadId: string;
  connectionOnline: boolean;
}) {
  const [state, dispatch] = useReducer(realtimeReducer, initialRealtimeState);
  const stateRef = useRef(state);
  const captureRef = useRef<RealtimeAudioCaptureSource | null>(null);
  const playbackRef = useRef<RealtimeAudioPlayback | null>(null);
  const sendQueueRef = useRef(Promise.resolve());
  stateRef.current = state;

  const releaseAudio = useCallback(() => {
    captureRef.current?.close();
    playbackRef.current?.close();
    captureRef.current = null;
    playbackRef.current = null;
    sendQueueRef.current = Promise.resolve();
  }, []);

  const closeLocally = useCallback(() => {
    releaseAudio();
    dispatch({ type: "closed" });
  }, [releaseAudio]);

  const sendChunk = useCallback(
    (chunk: RealtimeAudioChunk) => {
      if (!client || stateRef.current.status !== "listening") return;
      sendQueueRef.current = sendQueueRef.current
        .then(async () => {
          await appendRealtimeAudio(client, threadId, chunk);
        })
        .catch((reason) => {
          releaseAudio();
          dispatch({
            type: "error",
            message:
              reason instanceof Error ? reason.message : String(reason),
          });
        });
    },
    [client, releaseAudio, threadId],
  );

  useEffect(() => {
    if (!client || !threadId) return;
    const handleNotification = (message: RpcMessage) => {
      if (!isRealtimeNotificationForThread(message, threadId)) return;
      const params = (message.params ?? {}) as Record<string, any>;
      switch (message.method) {
        case "thread/realtime/started":
          dispatch({
            type: "started",
            sessionId: params.realtimeSessionId ?? null,
          });
          try {
            captureRef.current?.start(sendChunk);
          } catch (reason) {
            releaseAudio();
            dispatch({
              type: "error",
              message:
                reason instanceof Error ? reason.message : String(reason),
            });
          }
          break;
        case "thread/realtime/transcript/delta":
          dispatch({
            type: "transcript",
            role: params.role,
            delta: params.delta ?? "",
          });
          break;
        case "thread/realtime/transcript/done":
          dispatch({
            type: "transcript",
            role: params.role,
            delta: params.text ?? "",
            final: true,
          });
          break;
        case "thread/realtime/outputAudio/delta":
          if (params.audio) {
            void playbackRef.current?.append(params.audio);
          }
          break;
        case "thread/realtime/error":
          releaseAudio();
          dispatch({
            type: "error",
            message: params.message || "实时会话发生错误",
          });
          break;
        case "thread/realtime/closed":
          closeLocally();
          break;
      }
    };
    const unsubscribe = client.onNotification(handleNotification);
    return () => {
      unsubscribe();
    };
  }, [client, closeLocally, releaseAudio, sendChunk, threadId]);

  useEffect(() => {
    if (connectionOnline) return;
    closeLocally();
  }, [closeLocally, connectionOnline]);

  useEffect(() => {
    const handleVisibility = () => {
      if (
        document.visibilityState === "hidden" &&
        stateRef.current.status !== "idle"
      ) {
        if (client) {
          void stopRealtimeSession(client, threadId).catch(() => undefined);
        }
        closeLocally();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      releaseAudio();
    };
  }, [client, closeLocally, releaseAudio, threadId]);

  useEffect(() => {
    const handleNativeAudio = (event: Event) => {
      const detail = (
        event as CustomEvent<{ type?: string; message?: string }>
      ).detail;
      if (detail?.type !== "error") return;
      releaseAudio();
      if (client && threadId) {
        void stopRealtimeSession(client, threadId).catch(() => undefined);
      }
      dispatch({
        type: "error",
        message: detail.message || "原生麦克风启动失败",
      });
    };
    window.addEventListener(NATIVE_REALTIME_AUDIO_EVENT, handleNativeAudio);
    return () =>
      window.removeEventListener(
        NATIVE_REALTIME_AUDIO_EVENT,
        handleNativeAudio,
      );
  }, [client, releaseAudio, threadId]);

  const start = useCallback(async () => {
    if (!client || !threadId || stateRef.current.status !== "idle") return;
    const unsupported = realtimeUnavailableReason({
      hasGetUserMedia: Boolean(navigator.mediaDevices?.getUserMedia),
      isSecureContext: window.isSecureContext,
      protocol: location.protocol,
      hasNativeBridge: hasNativeRealtimeAudioBridge(),
    });
    if (unsupported) {
      dispatch({ type: "error", message: unsupported });
      return;
    }
    dispatch({ type: "start", startedAt: Date.now() });
    const capture = createRealtimeAudioCapture();
    const playback = new RealtimeAudioPlayback();
    captureRef.current = capture;
    playbackRef.current = playback;
    try {
      await Promise.all([capture.open(), playback.unlock()]);
      await startRealtimeSession(client, threadId);
    } catch (reason) {
      releaseAudio();
      dispatch({
        type: "error",
        message: reason instanceof Error ? reason.message : String(reason),
      });
    }
  }, [client, releaseAudio, threadId]);

  const stop = useCallback(async () => {
    if (!client || stateRef.current.status === "idle") return;
    dispatch({ type: "stopping" });
    captureRef.current?.close();
    captureRef.current = null;
    try {
      await stopRealtimeSession(client, threadId);
      closeLocally();
    } catch (reason) {
      dispatch({
        type: "error",
        message: reason instanceof Error ? reason.message : String(reason),
      });
      releaseAudio();
    }
  }, [client, closeLocally, releaseAudio, threadId]);

  const toggleMute = useCallback(() => {
    const muted = !stateRef.current.muted;
    captureRef.current?.setMuted(muted);
    dispatch({ type: "mute", muted });
  }, []);

  return {
    state,
    start,
    stop,
    toggleMute,
    dismissError: closeLocally,
  };
}

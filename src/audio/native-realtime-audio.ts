import type { RealtimeAudioChunk } from "../app-server/realtime";

export const NATIVE_REALTIME_AUDIO_EVENT = "codex-mobile-realtime-audio";

interface AndroidRealtimeAudioBridge {
  realtimeAudioStart?: () => void;
  realtimeAudioStop?: () => void;
  realtimeAudioSetMuted?: (muted: boolean) => void;
}

interface IOSRealtimeAudioHandler {
  postMessage: (message: {
    action: "start" | "stop" | "mute";
    muted?: boolean;
  }) => void;
}

export interface NativeRealtimeAudioBridge {
  start: () => void;
  stop: () => void;
  setMuted: (muted: boolean) => void;
}

export interface NativeRealtimeAudioEvent {
  type: "started" | "chunk" | "stopped" | "error";
  data?: string;
  sampleRate?: number;
  numChannels?: number;
  samplesPerChannel?: number;
  message?: string;
}

export function readNativeRealtimeAudioBridge(
  scope: typeof window = window,
): NativeRealtimeAudioBridge | null {
  const android = (
    scope as typeof window & { JsBridge?: AndroidRealtimeAudioBridge }
  ).JsBridge;
  if (
    typeof android?.realtimeAudioStart === "function" &&
    typeof android.realtimeAudioStop === "function" &&
    typeof android.realtimeAudioSetMuted === "function"
  ) {
    return {
      start: () => android.realtimeAudioStart!(),
      stop: () => android.realtimeAudioStop!(),
      setMuted: (muted) => android.realtimeAudioSetMuted!(muted),
    };
  }

  const ios = (
    scope as typeof window & {
      webkit?: {
        messageHandlers?: { realtimeAudio?: IOSRealtimeAudioHandler };
      };
    }
  ).webkit?.messageHandlers?.realtimeAudio;
  if (typeof ios?.postMessage === "function") {
    return {
      start: () => ios.postMessage({ action: "start" }),
      stop: () => ios.postMessage({ action: "stop" }),
      setMuted: (muted) =>
        ios.postMessage({ action: "mute", muted }),
    };
  }
  return null;
}

export class NativeRealtimeAudioCapture {
  private bridge: NativeRealtimeAudioBridge | null = null;
  private onChunk: ((chunk: RealtimeAudioChunk) => void) | null = null;
  private pending: RealtimeAudioChunk[] = [];

  private readonly handleAudio = (event: Event) => {
    const detail = (event as CustomEvent<NativeRealtimeAudioEvent>).detail;
    if (detail.type === "error") return;
    if (
      detail.type !== "chunk" ||
      !detail.data ||
      !detail.sampleRate ||
      !detail.numChannels
    ) {
      return;
    }
    const chunk: RealtimeAudioChunk = {
      data: detail.data,
      sampleRate: detail.sampleRate,
      numChannels: detail.numChannels,
      samplesPerChannel: detail.samplesPerChannel ?? null,
    };
    if (this.onChunk) this.onChunk(chunk);
    else {
      this.pending.push(chunk);
      if (this.pending.length > 10) this.pending.shift();
    }
  };

  async open() {
    this.bridge = readNativeRealtimeAudioBridge();
    if (!this.bridge) throw new Error("原生麦克风 Bridge 不可用");
    window.addEventListener(NATIVE_REALTIME_AUDIO_EVENT, this.handleAudio);
    this.bridge.start();
  }

  start(onChunk: (chunk: RealtimeAudioChunk) => void) {
    this.onChunk = onChunk;
    for (const chunk of this.pending.splice(0)) onChunk(chunk);
  }

  setMuted(muted: boolean) {
    this.bridge?.setMuted(muted);
  }

  close() {
    this.bridge?.stop();
    this.bridge = null;
    this.onChunk = null;
    this.pending = [];
    window.removeEventListener(NATIVE_REALTIME_AUDIO_EVENT, this.handleAudio);
  }
}

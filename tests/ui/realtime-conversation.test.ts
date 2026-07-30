import { describe, expect, it, vi } from "vitest";
import {
  appendRealtimeTranscript,
  initialRealtimeState,
  realtimeUnavailableReason,
  realtimeReducer,
} from "../../src/app-server/realtime";
import { encodePcm16 } from "../../src/audio/realtime-audio";
import { readNativeRealtimeAudioBridge } from "../../src/audio/native-realtime-audio";

describe("实时会话状态机", () => {
  it("按连接、聆听、结束顺序转换，结束后清空临时转写", () => {
    const connecting = realtimeReducer(initialRealtimeState, {
      type: "start",
      startedAt: 100,
    });
    expect(connecting.status).toBe("connecting");

    const listening = realtimeReducer(connecting, {
      type: "started",
      sessionId: "realtime-1",
    });
    expect(listening).toMatchObject({
      status: "listening",
      sessionId: "realtime-1",
    });

    const stopped = realtimeReducer(
      {
        ...listening,
        userTranscript: "你好",
        assistantTranscript: "你好，需要我做什么？",
      },
      { type: "closed" },
    );
    expect(stopped).toEqual(initialRealtimeState);
  });

  it("分别累积用户和助手的临时转写", () => {
    const user = appendRealtimeTranscript(initialRealtimeState, "user", "你好");
    const assistant = appendRealtimeTranscript(user, "assistant", "收到");

    expect(assistant.userTranscript).toBe("你好");
    expect(assistant.assistantTranscript).toBe("收到");
  });

  it("错误状态保留可展示的中文错误", () => {
    const state = realtimeReducer(initialRealtimeState, {
      type: "error",
      message: "实时会话不可用",
    });
    expect(state).toMatchObject({
      status: "error",
      error: "实时会话不可用",
    });
  });

  it("麦克风浮点采样转换为 24kHz 单声道 PCM16", () => {
    const chunk = encodePcm16(
      new Float32Array([-1, -0.5, 0, 0.5, 1]),
      24_000,
    );
    expect(chunk).toMatchObject({
      sampleRate: 24_000,
      numChannels: 1,
      samplesPerChannel: 5,
    });
    expect(atob(chunk.data)).toHaveLength(10);
  });

  it("局域网 HTTP 优先提示安全上下文限制，而不是误报不支持麦克风", () => {
    expect(
      realtimeUnavailableReason({
        hasGetUserMedia: false,
        isSecureContext: false,
        protocol: "http:",
      }),
    ).toBe("当前页面使用 HTTP，浏览器仅允许在 HTTPS 页面申请麦克风权限");
  });

  it("App 原生麦克风 Bridge 可以绕过网页安全上下文限制", () => {
    expect(
      realtimeUnavailableReason({
        hasGetUserMedia: false,
        isSecureContext: false,
        protocol: "http:",
        hasNativeBridge: true,
      }),
    ).toBe("");
  });

  it("优先识别 Android 原生麦克风 Bridge", () => {
    const start = vi.fn();
    const stop = vi.fn();
    const mute = vi.fn();
    const bridge = readNativeRealtimeAudioBridge({
      JsBridge: {
        realtimeAudioStart: start,
        realtimeAudioStop: stop,
        realtimeAudioSetMuted: mute,
      },
    } as never);

    bridge?.start();
    bridge?.setMuted(true);
    bridge?.stop();

    expect(start).toHaveBeenCalledOnce();
    expect(mute).toHaveBeenCalledWith(true);
    expect(stop).toHaveBeenCalledOnce();
  });

  it("识别 iOS messageHandler 麦克风 Bridge", () => {
    const postMessage = vi.fn();
    const bridge = readNativeRealtimeAudioBridge({
      webkit: {
        messageHandlers: {
          realtimeAudio: { postMessage },
        },
      },
    } as never);

    bridge?.start();
    bridge?.setMuted(true);
    bridge?.stop();

    expect(postMessage.mock.calls).toEqual([
      [{ action: "start" }],
      [{ action: "mute", muted: true }],
      [{ action: "stop" }],
    ]);
  });
});

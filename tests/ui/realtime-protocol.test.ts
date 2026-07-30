import { describe, expect, it, vi } from "vitest";
import {
  appendRealtimeAudio,
  startRealtimeSession,
  stopRealtimeSession,
} from "../../src/app-server/realtime";

describe("实时会话 app-server 协议", () => {
  it("使用 v3 WebSocket 音频模式启动已有线程", async () => {
    const client = {
      request: vi.fn().mockResolvedValue({}),
    };

    await startRealtimeSession(client as never, "thread-1");

    expect(client.request).toHaveBeenCalledWith("thread/realtime/start", {
      threadId: "thread-1",
      outputModality: "audio",
      version: "v3",
      voice: "cove",
      transport: { type: "websocket" },
      includeStartupContext: true,
      clientManagedHandoffs: false,
    });
  });

  it("发送带采样信息的音频分片并可停止", async () => {
    const client = {
      request: vi.fn().mockResolvedValue({}),
    };
    const audio = {
      data: "AQID",
      sampleRate: 24_000,
      numChannels: 1,
      samplesPerChannel: 480,
    };

    await appendRealtimeAudio(client as never, "thread-1", audio);
    await stopRealtimeSession(client as never, "thread-1");

    expect(client.request).toHaveBeenNthCalledWith(
      1,
      "thread/realtime/appendAudio",
      { threadId: "thread-1", audio },
      { timeoutMs: 30_000 },
    );
    expect(client.request).toHaveBeenNthCalledWith(
      2,
      "thread/realtime/stop",
      { threadId: "thread-1" },
    );
  });
});

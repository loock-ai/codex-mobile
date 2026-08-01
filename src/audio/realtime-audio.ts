import type { RealtimeAudioChunk } from "../app-server/realtime";
import { t } from "../i18n";
import {
  NativeRealtimeAudioCapture,
  readNativeRealtimeAudioBridge,
} from "./native-realtime-audio";

const TARGET_SAMPLE_RATE = 24_000;
const PROCESSOR_BUFFER_SIZE = 4096;

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(data: string) {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function resample(input: Float32Array, sourceRate: number, targetRate: number) {
  if (sourceRate === targetRate) return input;
  const ratio = sourceRate / targetRate;
  const output = new Float32Array(Math.max(1, Math.round(input.length / ratio)));
  for (let index = 0; index < output.length; index += 1) {
    const sourceIndex = index * ratio;
    const lower = Math.floor(sourceIndex);
    const upper = Math.min(input.length - 1, lower + 1);
    const fraction = sourceIndex - lower;
    output[index] =
      input[lower] * (1 - fraction) + input[upper] * fraction;
  }
  return output;
}

export function encodePcm16(
  input: Float32Array,
  sourceRate: number,
): RealtimeAudioChunk {
  const samples = resample(input, sourceRate, TARGET_SAMPLE_RATE);
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  samples.forEach((sample, index) => {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(
      index * 2,
      clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff,
      true,
    );
  });
  return {
    data: bytesToBase64(bytes),
    sampleRate: TARGET_SAMPLE_RATE,
    numChannels: 1,
    samplesPerChannel: samples.length,
  };
}

export class RealtimeAudioCapture {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;

  async open() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(t("当前环境不支持麦克风"));
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    this.context = new AudioContext();
    await this.context.resume();
  }

  start(onChunk: (chunk: RealtimeAudioChunk) => void) {
    if (!this.stream || !this.context) {
      throw new Error(t("麦克风尚未准备完成"));
    }
    this.source = this.context.createMediaStreamSource(this.stream);
    this.processor = this.context.createScriptProcessor(
      PROCESSOR_BUFFER_SIZE,
      1,
      1,
    );
    this.processor.onaudioprocess = (event) => {
      onChunk(
        encodePcm16(
          event.inputBuffer.getChannelData(0),
          event.inputBuffer.sampleRate,
        ),
      );
    };
    this.source.connect(this.processor);
    this.processor.connect(this.context.destination);
  }

  setMuted(muted: boolean) {
    for (const track of this.stream?.getAudioTracks() ?? []) {
      track.enabled = !muted;
    }
  }

  close() {
    this.processor?.disconnect();
    this.source?.disconnect();
    this.processor = null;
    this.source = null;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    void this.context?.close();
    this.context = null;
  }
}

export type RealtimeAudioCaptureSource =
  | RealtimeAudioCapture
  | NativeRealtimeAudioCapture;

export function hasNativeRealtimeAudioBridge() {
  return Boolean(readNativeRealtimeAudioBridge());
}

export function createRealtimeAudioCapture(): RealtimeAudioCaptureSource {
  return readNativeRealtimeAudioBridge()
    ? new NativeRealtimeAudioCapture()
    : new RealtimeAudioCapture();
}

export class RealtimeAudioPlayback {
  private context: AudioContext | null = null;
  private nextStartTime = 0;

  async unlock() {
    this.context ??= new AudioContext();
    await this.context.resume();
  }

  async append(chunk: RealtimeAudioChunk) {
    await this.unlock();
    const context = this.context!;
    const bytes = base64ToBytes(chunk.data);
    const sampleCount = Math.floor(bytes.length / 2);
    const buffer = context.createBuffer(
      chunk.numChannels || 1,
      sampleCount / Math.max(1, chunk.numChannels),
      chunk.sampleRate,
    );
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const output = buffer.getChannelData(channel);
      for (let index = 0; index < output.length; index += 1) {
        output[index] =
          view.getInt16(
            (index * buffer.numberOfChannels + channel) * 2,
            true,
          ) / 0x8000;
      }
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    const startAt = Math.max(context.currentTime, this.nextStartTime);
    source.start(startAt);
    this.nextStartTime = startAt + buffer.duration;
  }

  close() {
    this.nextStartTime = 0;
    void this.context?.close();
    this.context = null;
  }
}

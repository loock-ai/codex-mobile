import { describe, expect, it } from "vitest";
import {
  MAX_DRAFT_IMAGES,
  MAX_IMAGE_BYTES,
  MAX_TOTAL_IMAGE_BYTES,
  MAX_FILE_BYTES,
  ImageReadGeneration,
  buildOptimisticUserContent,
  buildTurnInput,
  mergeDraftImages,
  prepareImageFiles,
  prepareAttachmentFiles,
} from "../../src/ui/attachments";

const tinyPng = "data:image/png;base64,iVBORw0KGgo=";

describe("图片输入", () => {
  it("读取受支持图片并保留 Data URL、名称和大小", async () => {
    const file = new File(["png"], "界面.png", { type: "image/png" });
    const result = await prepareImageFiles([file], 0, async () => tinyPng);

    expect(result.errors).toEqual([]);
    expect(result.images).toEqual([
      expect.objectContaining({
        name: "界面.png",
        type: "image/png",
        size: 3,
        url: tinyPng,
      }),
    ]);
  });

  it("拒绝不支持的格式、超大文件和超过四张的选择", async () => {
    const textFile = new File(["text"], "说明.txt", { type: "text/plain" });
    const huge = new File(
      [new Uint8Array(MAX_IMAGE_BYTES + 1)],
      "超大.png",
      { type: "image/png" },
    );
    const extras = Array.from(
      { length: MAX_DRAFT_IMAGES },
      (_, index) =>
        new File(["x"], `${index}.png`, { type: "image/png" }),
    );

    const invalid = await prepareImageFiles(
      [textFile, huge],
      0,
      async () => tinyPng,
    );
    expect(invalid.images).toEqual([]);
    expect(invalid.errors.join(" ")).toContain("说明.txt");
    expect(invalid.errors.join(" ")).toContain("超大.png");

    const limited = await prepareImageFiles(
      extras,
      MAX_DRAFT_IMAGES - 1,
      async () => tinyPng,
    );
    expect(limited.images).toHaveLength(1);
    expect(limited.errors.join(" ")).toContain("最多上传 4 张图片");
  });

  it("限制草稿图片累计原始大小为 20 MiB", async () => {
    const file = new File(
      [new Uint8Array(2 * 1024 * 1024)],
      "追加.png",
      { type: "image/png" },
    );
    const result = await prepareImageFiles(
      [file],
      1,
      async () => tinyPng,
      MAX_TOTAL_IMAGE_BYTES - 1024 * 1024,
    );

    expect(result.images).toEqual([]);
    expect(result.errors.join(" ")).toContain("总大小不能超过 20 MB");
  });

  it("拒绝与 file.type 不一致或不是 Data URL 的读取结果", async () => {
    const file = new File(["png"], "伪装.png", { type: "image/png" });

    const mismatched = await prepareImageFiles(
      [file],
      0,
      async () => "data:image/jpeg;base64,ZmFrZQ==",
    );
    const plainText = await prepareImageFiles(
      [file],
      0,
      async () => "not-a-data-url",
    );

    expect(mismatched.images).toEqual([]);
    expect(plainText.images).toEqual([]);
    expect(mismatched.errors.join(" ")).toContain("内容格式");
    expect(plainText.errors.join(" ")).toContain("内容格式");
  });

  it("generation 失效后拒绝迟到的 FileReader 批次", () => {
    const generation = new ImageReadGeneration();
    const first = generation.begin();
    expect(generation.isCurrent(first)).toBe(true);

    generation.invalidate();
    expect(generation.isCurrent(first)).toBe(false);

    const second = generation.begin();
    expect(generation.isCurrent(second)).toBe(true);
  });

  it("发送失败时保留后来选择的图片并去重恢复失败批次", () => {
    const failed = {
      id: "failed",
      name: "same.png",
      type: "image/png",
      size: 3,
      url: tinyPng,
    };
    const laterDuplicate = { ...failed, id: "later" };
    const later = {
      id: "later-2",
      name: "later.png",
      type: "image/png",
      size: 4,
      url: "data:image/png;base64,bGF0ZXI=",
    };

    expect(mergeDraftImages([laterDuplicate, later], [failed])).toEqual([
      laterDuplicate,
      later,
    ]);
  });

  it("生成纯图片和图文混合的 V2 input 与乐观用户消息", () => {
    const image = {
      id: "draft-1",
      name: "界面.png",
      type: "image/png",
      size: 3,
      url: tinyPng,
    };

    expect(buildTurnInput("", [image])).toEqual([
      { type: "image", url: tinyPng },
    ]);
    expect(buildTurnInput("请查看", [image])).toEqual([
      { type: "text", text: "请查看", text_elements: [] },
      { type: "image", url: tinyPng },
    ]);
    expect(buildOptimisticUserContent("请查看", [image])).toEqual([
      { type: "text", text: "请查看" },
      { type: "image", url: tinyPng },
    ]);
  });

  it("接受视频、PDF 和无 MIME 文件，并限制单文件大小与附件数量", () => {
    const video = new File(["video"], "演示.mp4", { type: "video/mp4" });
    const pdf = new File(["pdf"], "说明.pdf", { type: "application/pdf" });
    const source = new File(["code"], "main.rs");
    const accepted = prepareAttachmentFiles(
      [video, pdf, source],
      0,
      (file) => `blob:${file.name}`,
    );
    expect(accepted.errors).toEqual([]);
    expect(accepted.files).toEqual([
      expect.objectContaining({
        name: "演示.mp4",
        type: "video/mp4",
        size: 5,
        previewUrl: "blob:演示.mp4",
        file: video,
      }),
      expect.objectContaining({ name: "说明.pdf", type: "application/pdf" }),
      expect.objectContaining({ name: "main.rs", type: "application/octet-stream" }),
    ]);

    const huge = new File(["video"], "超大.mp4", { type: "video/mp4" });
    Object.defineProperty(huge, "size", { value: MAX_FILE_BYTES + 1 });
    expect(prepareAttachmentFiles([huge], 0).errors.join(" ")).toContain("100 MB");
    expect(prepareAttachmentFiles([video], 4).errors.join(" ")).toContain(
      "最多上传 4 个文件",
    );
  });

  it("把已上传文件的机器路径加入发送输入和乐观消息", () => {
    const file = {
      name: "需求.pdf",
      type: "application/pdf",
      size: 5,
      path: "/tmp/codex-mobile/需求.pdf",
    };
    expect(buildTurnInput("总结这个文件", [], [file])).toEqual([
      { type: "text", text: "总结这个文件", text_elements: [] },
      {
        type: "text",
        text: "已上传文件：[需求.pdf](/tmp/codex-mobile/%E9%9C%80%E6%B1%82.pdf)\n本机路径：`/tmp/codex-mobile/需求.pdf`",
        text_elements: [],
      },
    ]);
    expect(buildOptimisticUserContent("", [], [file])).toEqual([
      {
        type: "text",
        text: "已上传文件：[需求.pdf](/tmp/codex-mobile/%E9%9C%80%E6%B1%82.pdf)\n本机路径：`/tmp/codex-mobile/需求.pdf`",
      },
    ]);
  });
});

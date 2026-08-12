import { describe, expect, it, vi } from "vitest";
import { uploadFile } from "../../src/backends/file-upload";

describe("文件上传", () => {
  it("上传到当前网关并保留访问口令和文件信息", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          path: "/host/uploads/需求.pdf",
          name: "需求.pdf",
          type: "application/pdf",
          size: 3,
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      ),
    );
    const file = new File(["pdf"], "需求.pdf", { type: "application/pdf" });

    const result = await uploadFile(
      {
        id: "mac",
        name: "Mac",
        baseUrl: "http://mac.local:18766",
        token: "secret",
        enabled: true,
        order: 0,
      },
      file,
      fetcher,
    );

    expect(result.path).toBe("/host/uploads/需求.pdf");
    expect(fetcher).toHaveBeenCalledWith(
      "http://mac.local:18766/api/uploads/file?token=secret",
      expect.objectContaining({
        method: "POST",
        body: file,
        credentials: "include",
        headers: expect.objectContaining({
          "content-type": "application/pdf",
          "x-codex-file-name": encodeURIComponent("需求.pdf"),
        }),
      }),
    );
  });
});

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

it("附件写入未知不冒充消息发送未知，允许发送流程保留草稿", async () => {
 const fetcher = async () => new Response(JSON.stringify({error:"上传结果未知", code:"ACTION_WRITE_UNKNOWN"}), {status:502});
 await expect(uploadFile({id:"mac",name:"Mac",baseUrl:"http://mac.local",token:"",enabled:true,order:0},new File(["image"],"settings.png"),fetcher)).rejects.toMatchObject({code:"UPLOAD_WRITE_UNKNOWN"});
});

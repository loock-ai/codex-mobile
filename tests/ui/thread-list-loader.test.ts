import { describe, expect, it, vi } from "vitest";
import { createLatestThreadListLoader } from "../../src/app-server/thread-list-loader";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("会话列表轮询加载器", () => {
  it("按配置项目分别获取最新 5 条会话并独立提交结果", async () => {
    const projectA = deferred<{ data: Array<{ id: string; cwd: string }> }>();
    const projectB = deferred<{ data: Array<{ id: string; cwd: string }> }>();
    const client = {
      request: vi.fn((_method: string, params: { cwd: string }) =>
        params.cwd === "/project/a" ? projectA.promise : projectB.promise,
      ),
    };
    const onProjectStart = vi.fn();
    const onProjectData = vi.fn();
    const onSettled = vi.fn();
    const loader = createLatestThreadListLoader({
      onProjectStart,
      onProjectData,
      onSettled,
    });

    const loading = loader.load(client, ["/project/a", "/project/b"]);

    expect(client.request).toHaveBeenCalledTimes(2);
    expect(client.request).toHaveBeenNthCalledWith(1, "thread/list", {
      limit: 5,
      cwd: "/project/a",
      sortKey: "updated_at",
    });
    expect(onProjectStart).toHaveBeenCalledWith("/project/a");
    expect(onProjectStart).toHaveBeenCalledWith("/project/b");

    projectB.resolve({
      data: [{ id: "thread-b", cwd: "/project/b" }],
    });
    await Promise.resolve();

    expect(onProjectData).toHaveBeenCalledOnce();
    expect(onProjectData).toHaveBeenLastCalledWith("/project/b", [
      { id: "thread-b", cwd: "/project/b" },
    ]);
    expect(onSettled).not.toHaveBeenCalled();

    projectA.resolve({
      data: [{ id: "thread-a", cwd: "/project/a" }],
    });
    await loading;

    expect(onProjectData).toHaveBeenLastCalledWith("/project/a", [
      { id: "thread-a", cwd: "/project/a" },
    ]);
    expect(onSettled).toHaveBeenCalledOnce();
  });

  it("单个项目失败不阻塞其他项目并在整轮结束后收口", async () => {
    const onProjectData = vi.fn();
    const onProjectError = vi.fn();
    const onSettled = vi.fn();
    const client = {
      request: vi.fn((_method: string, params: { cwd: string }) =>
        params.cwd === "/project/a"
          ? Promise.reject(new Error("project a failed"))
          : Promise.resolve({
              data: [{ id: "thread-b", cwd: "/project/b" }],
            }),
      ),
    };
    const loader = createLatestThreadListLoader({
      onProjectData,
      onProjectError,
      onSettled,
    });

    await expect(
      loader.load(client, ["/project/a", "/project/b"]),
    ).resolves.toBeUndefined();

    expect(onProjectError).toHaveBeenCalledWith(
      "/project/a",
      expect.objectContaining({ message: "project a failed" }),
    );
    expect(onProjectData).toHaveBeenCalledWith("/project/b", [
      { id: "thread-b", cwd: "/project/b" },
    ]);
    expect(onSettled).toHaveBeenCalledOnce();
  });

  it("项目重试后忽略同一项目旧请求的迟到结果", async () => {
    const firstResult =
      deferred<{ data: Array<{ id: string; cwd: string }> }>();
    const retryResult =
      deferred<{ data: Array<{ id: string; cwd: string }> }>();
    const client = {
      request: vi
        .fn()
        .mockReturnValueOnce(firstResult.promise)
        .mockReturnValueOnce(retryResult.promise),
    };
    const onProjectData = vi.fn();
    const loader = createLatestThreadListLoader({ onProjectData });

    const first = loader.loadProject(client, "/project/a");
    const retry = loader.loadProject(client, "/project/a");
    retryResult.resolve({
      data: [{ id: "retry", cwd: "/project/a" }],
    });
    await retry;
    firstResult.resolve({
      data: [{ id: "stale", cwd: "/project/a" }],
    });
    await first;

    expect(onProjectData).toHaveBeenCalledOnce();
    expect(onProjectData).toHaveBeenCalledWith("/project/a", [
      { id: "retry", cwd: "/project/a" },
    ]);
  });

  it("同一客户端的慢请求只保留一个在途请求", async () => {
    const result = deferred<{ data: Array<{ id: string }> }>();
    const client = { request: vi.fn(() => result.promise) };
    const onData = vi.fn();
    const loader = createLatestThreadListLoader({ onData });

    const first = loader.load(client);
    const second = loader.load(client);

    expect(client.request).toHaveBeenCalledOnce();
    result.resolve({ data: [{ id: "thread-1" }] });
    await Promise.all([first, second]);
    expect(onData).toHaveBeenCalledWith([{ id: "thread-1" }]);
  });

  it("忽略旧客户端晚于新客户端返回的列表", async () => {
    const oldResult = deferred<{ data: Array<{ id: string }> }>();
    const newResult = deferred<{ data: Array<{ id: string }> }>();
    const oldClient = { request: vi.fn(() => oldResult.promise) };
    const newClient = { request: vi.fn(() => newResult.promise) };
    const onData = vi.fn();
    const loader = createLatestThreadListLoader({ onData });

    const oldLoad = loader.load(oldClient);
    const newLoad = loader.load(newClient);
    newResult.resolve({ data: [{ id: "new" }] });
    await newLoad;
    oldResult.resolve({ data: [{ id: "old" }] });
    await oldLoad;

    expect(onData).toHaveBeenCalledTimes(1);
    expect(onData).toHaveBeenLastCalledWith([{ id: "new" }]);
  });
});

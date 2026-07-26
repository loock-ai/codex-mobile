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
  it("同一客户端的慢请求只保留一个在途请求", async () => {
    const result = deferred<{ data: Array<{ id: string }> }>();
    const client = { request: vi.fn(() => result.promise) };
    const onData = vi.fn();
    const loader = createLatestThreadListLoader(onData);

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
    const loader = createLatestThreadListLoader(onData);

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

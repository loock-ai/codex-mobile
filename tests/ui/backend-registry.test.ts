import { describe, expect, it } from "vitest";
import {
  BACKEND_REGISTRY_STORAGE_KEY,
  MAX_BACKENDS,
  assignBackendHostId,
  createDefaultBackendRegistry,
  loadBackendRegistry,
  moveBackend,
  normalizeBackendBaseUrl,
  removeBackend,
  saveBackendRegistry,
  setBackendEnabled,
  upsertBackend,
} from "../../src/backends/registry";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe("多后端配置存储", () => {
  it("首次打开时把当前 origin 建为默认后端", () => {
    expect(createDefaultBackendRegistry("http://192.168.100.8:4173/")).toEqual({
      version: 1,
      selectedBackendId: "current-origin",
      backends: [
        {
          id: "current-origin",
          name: "192.168.100.8",
          baseUrl: "http://192.168.100.8:4173",
          token: "",
          enabled: true,
          order: 0,
        },
      ],
    });
  });

  it("首次打开时迁移链接中的旧版访问口令", () => {
    const storage = new MemoryStorage();
    expect(
      loadBackendRegistry(
        storage,
        "http://192.168.100.8:4173",
        "legacy-token",
      ).backends[0].token,
    ).toBe("legacy-token");
  });

  it("规范化 HTTP 地址并拒绝不支持的协议和路径", () => {
    expect(normalizeBackendBaseUrl(" HTTP://Mac-Mini.Local:4173/ ")).toBe(
      "http://mac-mini.local:4173",
    );
    expect(() => normalizeBackendBaseUrl("ws://mac-mini.local:4173")).toThrow(
      "仅支持 HTTP 或 HTTPS",
    );
    expect(() =>
      normalizeBackendBaseUrl("http://mac-mini.local:4173/api"),
    ).toThrow("不能包含路径");
  });

  it("读取时清理损坏条目并修复无效选择", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      BACKEND_REGISTRY_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        selectedBackendId: "missing",
        backends: [
          {
            id: "mini",
            name: "Mac mini",
            baseUrl: "http://MAC-MINI.local:4173/",
            token: "mini-token",
            enabled: true,
            order: 5,
          },
          {
            id: "",
            name: "损坏",
            baseUrl: "javascript:alert(1)",
          },
        ],
      }),
    );

    expect(
      loadBackendRegistry(storage, "http://192.168.100.35:4173"),
    ).toEqual({
      version: 1,
      selectedBackendId: "mini",
      backends: [
        {
          id: "mini",
          name: "Mac mini",
          baseUrl: "http://mac-mini.local:4173",
          token: "mini-token",
          enabled: true,
          order: 0,
        },
      ],
    });
  });

  it("新增或更新后端时拒绝重复地址并限制数量", () => {
    let registry = createDefaultBackendRegistry("http://127.0.0.1:4173");
    registry = upsertBackend(registry, {
      id: "mini",
      name: "Mac mini",
      baseUrl: "http://192.168.100.8:4173",
      token: "token",
      enabled: true,
      order: 1,
    });

    expect(() =>
      upsertBackend(registry, {
        id: "duplicate",
        name: "重复设备",
        baseUrl: "http://192.168.100.8:4173/",
        token: "",
        enabled: true,
        order: 2,
      }),
    ).toThrow("后端地址已存在");

    for (let index = registry.backends.length; index < MAX_BACKENDS; index += 1) {
      registry = upsertBackend(registry, {
        id: `host-${index}`,
        name: `Host ${index}`,
        baseUrl: `http://192.168.100.${index + 10}:4173`,
        token: "",
        enabled: true,
        order: index,
      });
    }

    expect(() =>
      upsertBackend(registry, {
        id: "overflow",
        name: "Overflow",
        baseUrl: "http://192.168.100.99:4173",
        token: "",
        enabled: true,
        order: MAX_BACKENDS,
      }),
    ).toThrow(`最多只能保存 ${MAX_BACKENDS} 个后端`);
  });

  it("拒绝通过不同 URL 重复保存同一真实设备身份", () => {
    const registry = {
      ...createDefaultBackendRegistry("http://192.168.100.8:4173"),
      backends: [
        {
          ...createDefaultBackendRegistry(
            "http://192.168.100.8:4173",
          ).backends[0],
          hostId: "mac-mini",
        },
      ],
    };
    expect(() =>
      upsertBackend(registry, {
        id: "alias",
        hostId: "mac-mini",
        name: "Mac mini 别名",
        baseUrl: "http://mac-mini.local:4173",
        token: "",
        enabled: true,
        order: 1,
      }),
    ).toThrow("设备身份已存在");
  });

  it("读取旧缓存时按 hostId 合并同一设备的地址别名", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      BACKEND_REGISTRY_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        selectedBackendId: "mini-alias",
        backends: [
          {
            id: "mini",
            hostId: "mac-mini",
            name: "Mac mini",
            baseUrl: "http://192.168.100.8:4173",
            enabled: true,
            order: 0,
          },
          {
            id: "mini-alias",
            hostId: "mac-mini",
            name: "Mac mini 别名",
            baseUrl: "http://mac-mini.local:4173",
            enabled: true,
            order: 1,
          },
        ],
      }),
    );

    expect(
      loadBackendRegistry(storage, "http://192.168.100.8:4173"),
    ).toMatchObject({
      selectedBackendId: "mini",
      backends: [{ id: "mini", hostId: "mac-mini", order: 0 }],
    });
  });

  it("自动探测到重复 hostId 时保留顺序靠前的设备并修复选择", () => {
    let registry = createDefaultBackendRegistry(
      "http://192.168.100.8:4173",
    );
    registry = upsertBackend(registry, {
      id: "mini-alias",
      hostId: "mac-mini",
      name: "Mac mini 别名",
      baseUrl: "http://mac-mini.local:4173",
      token: "alias-token",
      enabled: true,
      order: 1,
    });
    registry.selectedBackendId = "mini-alias";

    const next = assignBackendHostId(
      registry,
      "current-origin",
      "mac-mini",
    );

    expect(next.backends).toEqual([
      expect.objectContaining({
        id: "current-origin",
        hostId: "mac-mini",
        order: 0,
      }),
    ]);
    expect(next.selectedBackendId).toBe("current-origin");
  });

  it("保存后可按排序和选择状态恢复", () => {
    const storage = new MemoryStorage();
    const registry = upsertBackend(
      createDefaultBackendRegistry("http://127.0.0.1:4173"),
      {
        id: "mini",
        name: "Mac mini",
        baseUrl: "http://192.168.100.8:4173",
        token: "secret",
        enabled: true,
        order: -1,
      },
    );
    registry.selectedBackendId = "mini";

    saveBackendRegistry(storage, registry);

    expect(
      loadBackendRegistry(storage, "http://127.0.0.1:4173"),
    ).toMatchObject({
      selectedBackendId: "mini",
      backends: [
        { id: "mini", order: 0 },
        { id: "current-origin", order: 1 },
      ],
    });
  });

  it("禁用或删除当前设备时选择下一个已启用设备", () => {
    let registry = upsertBackend(
      createDefaultBackendRegistry("http://127.0.0.1:4173"),
      {
        id: "mini",
        name: "Mac mini",
        baseUrl: "http://192.168.100.8:4173",
        token: "",
        enabled: true,
        order: 1,
      },
    );
    registry.selectedBackendId = "current-origin";

    registry = setBackendEnabled(registry, "current-origin", false);
    expect(registry.selectedBackendId).toBe("mini");

    expect(() => setBackendEnabled(registry, "mini", false)).toThrow(
      "至少保留一个已启用设备",
    );

    registry = removeBackend(registry, "current-origin");
    expect(registry.backends.map((entry) => entry.id)).toEqual(["mini"]);
    expect(() => removeBackend(registry, "mini")).toThrow(
      "至少保留一个设备",
    );
  });

  it("调整设备顺序后重新编号", () => {
    let registry = upsertBackend(
      createDefaultBackendRegistry("http://127.0.0.1:4173"),
      {
        id: "mini",
        name: "Mac mini",
        baseUrl: "http://192.168.100.8:4173",
        token: "",
        enabled: true,
        order: 1,
      },
    );

    registry = moveBackend(registry, "mini", -1);
    expect(registry.backends.map((entry) => [entry.id, entry.order])).toEqual([
      ["mini", 0],
      ["current-origin", 1],
    ]);
  });
});

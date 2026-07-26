import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BackendSwitcher } from "../../src/features/backends/BackendSwitcher";
import { BackendAttentionBanner } from "../../src/features/backends/BackendAttentionBanner";
import { BackendManagerSheet } from "../../src/features/backends/BackendManagerSheet";
import { createDefaultBackendRegistry } from "../../src/backends/registry";
import type {
  BackendConfig,
  BackendRuntimeSummary,
} from "../../src/backends/types";

const mini: BackendConfig = {
  id: "mini",
  name: "Mac mini",
  baseUrl: "http://192.168.100.8:4173",
  token: "",
  enabled: true,
  order: 0,
};
const macbook: BackendConfig = {
  id: "macbook",
  name: "MacBook",
  baseUrl: "http://192.168.100.35:4173",
  token: "",
  enabled: true,
  order: 1,
};
const summaries: Record<string, BackendRuntimeSummary> = {
  mini: {
    backendId: "mini",
    connection: "online",
    busy: true,
    approvalCount: 0,
    error: "",
  },
  macbook: {
    backendId: "macbook",
    connection: "online",
    busy: false,
    approvalCount: 2,
    error: "",
  },
};

describe("多设备界面", () => {
  it("设备切换器展示连接、运行和审批状态", () => {
    const onSelect = vi.fn();
    render(
      <BackendSwitcher
        backends={[mini, macbook]}
        summaries={summaries}
        selectedBackendId="mini"
        onSelect={onSelect}
        onManage={() => undefined}
      />,
    );

    expect(
      screen
        .getByRole("button", { name: /Mac mini.*进行中/ })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /MacBook.*2 个待审批/ }));
    expect(onSelect).toHaveBeenCalledWith("macbook");
  });

  it("后台设备有审批时提醒并可切换来源设备", () => {
    const onSelect = vi.fn();
    render(
      <BackendAttentionBanner
        backends={[mini, macbook]}
        summaries={summaries}
        selectedBackendId="mini"
        onSelect={onSelect}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "MacBook 有 2 个待审批" }));
    expect(onSelect).toHaveBeenCalledWith("macbook");
  });

  it("设备管理可新增通过探测的设备", async () => {
    const onChange = vi.fn();
    const probe = vi.fn(async () => ({
      hostId: "mini",
      displayName: "Mac mini",
      hostname: "mac-mini.local",
      gatewayVersion: "0.2.0",
      appServerReady: true,
    }));
    render(
      <BackendManagerSheet
        open
        registry={createDefaultBackendRegistry("http://127.0.0.1:4173")}
        summaries={{}}
        onChange={onChange}
        onClose={() => undefined}
        probe={probe}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "添加设备" }));
    fireEvent.change(screen.getByLabelText("设备名称"), {
      target: { value: "Mac mini" },
    });
    fireEvent.change(screen.getByLabelText("网关地址"), {
      target: { value: "http://192.168.100.8:4173" },
    });
    fireEvent.change(screen.getByLabelText("访问口令"), {
      target: { value: "secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "测试并保存" }));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(probe).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Mac mini",
        baseUrl: "http://192.168.100.8:4173",
        token: "secret",
      }),
    );
    expect(onChange.mock.calls[0][0].backends).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Mac mini",
          baseUrl: "http://192.168.100.8:4173",
        }),
      ]),
    );
  });

  it("设备管理支持编辑、暂停、排序和删除", async () => {
    const registry = {
      version: 1 as const,
      selectedBackendId: "mini",
      backends: [mini, macbook],
    };
    const onChange = vi.fn();
    const probe = vi.fn(async () => ({
      hostId: "mini",
      displayName: "Mac mini",
      hostname: "mac-mini.local",
      gatewayVersion: "0.2.0",
      appServerReady: true,
    }));
    const { rerender } = render(
      <BackendManagerSheet
        open
        registry={registry}
        summaries={summaries}
        onChange={onChange}
        onClose={() => undefined}
        probe={probe}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "编辑 Mac mini" }));
    fireEvent.change(screen.getByLabelText("设备名称"), {
      target: { value: "书房 Mac mini" },
    });
    fireEvent.click(screen.getByRole("button", { name: "测试并保存" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(onChange.mock.calls[0][0].backends[0]).toMatchObject({
      id: "mini",
      name: "书房 Mac mini",
    });

    rerender(
      <BackendManagerSheet
        open
        registry={registry}
        summaries={summaries}
        onChange={onChange}
        onClose={() => undefined}
        probe={probe}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "暂停 Mac mini" }));
    expect(onChange.mock.calls.at(-1)?.[0].backends[0].enabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "下移 Mac mini" }));
    expect(
      onChange.mock.calls
        .at(-1)?.[0]
        .backends.map((item: BackendConfig) => item.id),
    ).toEqual(["macbook", "mini"]);

    const originalConfirm = window.confirm;
    window.confirm = vi.fn(() => true);
    fireEvent.click(screen.getByRole("button", { name: "删除 MacBook" }));
    expect(
      onChange.mock.calls
        .at(-1)?.[0]
        .backends.map((item: BackendConfig) => item.id),
    ).toEqual(["mini"]);
    window.confirm = originalConfirm;
  });
});

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
  it("设备切换器只展示连接、加载和审批状态，不汇总会话运行状态", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <BackendSwitcher
        backends={[mini, macbook]}
        summaries={summaries}
        selectedBackendId="mini"
        onSelect={onSelect}
      />,
    );

    expect(screen.getByRole("button", { name: /全部设备/ })).not.toBeNull();
    expect(
      screen.queryByRole("button", { name: "添加或管理设备" }),
    ).toBeNull();
    const selectedMachine = screen.getByRole("button", {
      name: /Mac mini/,
    });
    expect(selectedMachine.getAttribute("aria-pressed")).toBe("true");
    expect(selectedMachine.textContent).not.toContain("▰");
    expect(selectedMachine.getAttribute("aria-label")).not.toContain("进行中");
    expect(
      screen.getByRole("button", { name: /全部设备/ }).getAttribute(
        "aria-label",
      ),
    ).not.toContain("进行中任务");
    expect(container.querySelector(".backend-busy")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /MacBook.*2 个待审批/ }));
    expect(onSelect).toHaveBeenCalledWith("macbook");
  });

  it("只有一台设备时仍展示全部 Tab", () => {
    const { container } = render(
      <BackendSwitcher
        backends={[mini]}
        summaries={summaries}
        selectedBackendId="all"
        onSelect={() => undefined}
      />,
    );
    const view = within(container);

    expect(
      view.getByRole("button", { name: /全部设备/ }).getAttribute(
        "aria-pressed",
      ),
    ).toBe("true");
    expect(view.getByRole("button", { name: /Mac mini/ })).not.toBeNull();
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
    expect(
      (screen.getByLabelText("网关地址") as HTMLInputElement).value,
    ).toBe("");
    fireEvent.change(screen.getByLabelText("设备名称"), {
      target: { value: "Mac mini" },
    });
    fireEvent.change(screen.getByLabelText("网关地址"), {
      target: { value: "http://192.168.100.8:4173/?token=secret" },
    });
    expect(screen.queryByLabelText("访问口令")).toBeNull();
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
    expect(
      (screen.getByLabelText("网关地址") as HTMLInputElement).value,
    ).toBe("http://192.168.100.8:4173/");
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

  it("Android 容器在设备管理底部展示版本和检查更新入口", () => {
    const onCheckUpdate = vi.fn();
    render(
      <BackendManagerSheet
        open
        registry={{
          version: 1,
          selectedBackendId: "mini",
          backends: [mini],
        }}
        summaries={summaries}
        onChange={() => undefined}
        onClose={() => undefined}
        appUpdate={{
          supported: true,
          currentVersion: "0.2.0",
          checking: false,
          onCheck: onCheckUpdate,
        }}
      />,
    );

    expect(screen.getByText("当前版本 v0.2.0")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "检查更新" }));
    expect(onCheckUpdate).toHaveBeenCalledTimes(1);
  });
});

import { act, renderHook } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { useSidebarRefresh } from "../../src/features/threads/sidebar-refresh";

describe("侧边栏刷新", () => {
  it("只在侧边栏从关闭变为打开时刷新，手动刷新复用同一入口", () => {
    const onRefresh = vi.fn();
    const { result } = renderHook(() => useSidebarRefresh(onRefresh));

    act(() => result.current.openSidebar());
    expect(onRefresh).not.toHaveBeenCalled();

    act(() => result.current.closeSidebar());
    act(() => result.current.openSidebar());
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(result.current.refreshVersion).toBe(1);

    act(() => result.current.openSidebar());
    expect(onRefresh).toHaveBeenCalledTimes(1);

    act(() => result.current.refresh());
    expect(onRefresh).toHaveBeenCalledTimes(2);
    expect(result.current.refreshVersion).toBe(2);
  });

  it("应用不再注册每分钟列表或时间刷新", () => {
    const source = readFileSync(resolve("src/App.tsx"), "utf8");

    expect(source).not.toContain("window.setInterval");
    expect(source).not.toContain("60_000");
  });
});

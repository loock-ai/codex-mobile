import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppBootstrap } from "../../src/App";

describe("应用后端初始化", () => {
  it("空后端首次启动时直接打开添加设备表单", () => {
    render(
      <AppBootstrap
        initialRegistry={{
          version: 1,
          selectedBackendId: "",
          backends: [],
        }}
      />,
    );

    expect(
      screen.getByRole("dialog", { name: "设备连接" }),
    ).not.toBeNull();
    expect(screen.getByLabelText("设备名称")).not.toBeNull();
    expect(screen.getByLabelText("网关地址")).not.toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import {
  approvalPolicyDescription,
  approvalPolicyLabel,
  effortOptionsForModel,
  modelOptionMeta,
  normalizeModelSettings,
  permissionModeFromSettings,
  permissionModesFromProfiles,
  permissionProfileLabel,
  speedOptionsForModel,
} from "../../src/ui/settings";

describe("移动端模型与审批设置", () => {
  it("为内置权限 profile 显示中文友好名", () => {
    expect(permissionProfileLabel(":read-only")).toBe("只读");
    expect(permissionProfileLabel(":workspace")).toBe("工作区访问");
    expect(permissionProfileLabel(":danger-full-access")).toBe("完全访问");
  });

  it("为审批策略显示友好中文与说明", () => {
    expect(approvalPolicyLabel("untrusted")).toBe("仅可信操作");
    expect(approvalPolicyLabel("on-request")).toBe("按需审批");
    expect(approvalPolicyLabel("never")).toBe("永不审批");
    expect(approvalPolicyDescription("on-request")).toContain("Codex");
  });

  it("模型选项保留 id 与描述以区分同显示名模型", () => {
    expect(
      modelOptionMeta({
        id: "terra-priority",
        model: "gpt-5.6-terra",
        displayName: "GPT-5.6-Terra",
        description: "均衡模型",
      }),
    ).toEqual({
      identity: "gpt-5.6-terra · terra-priority",
      description: "均衡模型",
    });
  });

  it("智能选项严格来自当前模型的 supportedReasoningEfforts", () => {
    expect(
      effortOptionsForModel({
        defaultReasoningEffort: "medium",
        supportedReasoningEfforts: [
          { reasoningEffort: "low", description: "更快响应" },
          { reasoningEffort: "medium", description: "平衡速度与质量" },
        ],
      }),
    ).toEqual([
      { id: "low", label: "低", description: "更快响应" },
      { id: "medium", label: "中", description: "平衡速度与质量" },
    ]);
  });

  it("速度选项只包含正常与当前模型 serviceTiers 返回项", () => {
    expect(
      speedOptionsForModel({
        serviceTiers: [
          {
            id: "priority",
            name: "Fast",
            description: "1.5x speed, increased usage",
          },
        ],
      }),
    ).toEqual([
      {
        id: null,
        label: "正常",
        description: "默认速度，正常用量",
      },
      {
        id: "priority",
        label: "Fast",
        description: "1.5x speed, increased usage",
      },
    ]);
    expect(speedOptionsForModel({ serviceTiers: [] })).toHaveLength(1);
  });

  it("切换模型后将不支持的智能与速度归一化到接口默认值", () => {
    expect(
      normalizeModelSettings(
        {
          defaultReasoningEffort: "medium",
          defaultServiceTier: null,
          supportedReasoningEfforts: [
            { reasoningEffort: "low", description: "" },
            { reasoningEffort: "medium", description: "" },
          ],
          serviceTiers: [],
        },
        "ultra",
        "priority",
      ),
    ).toEqual({ effort: "medium", serviceTier: null });
  });

  it("将旧版 fast 配置映射为 model/list 返回的规范 service tier id", () => {
    expect(
      normalizeModelSettings(
        {
          defaultReasoningEffort: "high",
          supportedReasoningEfforts: [
            { reasoningEffort: "high", description: "" },
          ],
          additionalSpeedTiers: ["fast"],
          serviceTiers: [
            { id: "priority", name: "Fast", description: "快速" },
          ],
        },
        "high",
        "fast",
      ),
    ).toEqual({ effort: "high", serviceTier: "priority" });
  });

  it("切换模型时将不支持的速度回退到接口声明的默认档位", () => {
    expect(
      normalizeModelSettings(
        {
          defaultReasoningEffort: "high",
          supportedReasoningEfforts: [
            { reasoningEffort: "high", description: "" },
          ],
          defaultServiceTier: "priority",
          serviceTiers: [
            { id: "priority", name: "Fast", description: "快速" },
          ],
        },
        "high",
        "old-tier",
      ),
    ).toEqual({ effort: "high", serviceTier: "priority" });
  });

  it("权限模式由 permissionProfile/list 过滤且不包含自定义项", () => {
    const modes = permissionModesFromProfiles([
      { id: ":read-only", allowed: true },
      { id: ":workspace", allowed: true },
      { id: ":danger-full-access", allowed: true },
      { id: ":ignored", allowed: false },
    ]);

    expect(modes.map((mode) => mode.id)).toEqual([
      "default",
      "auto-review",
      "read-only",
      "full-access",
    ]);
    expect(modes.some((mode) => mode.label.includes("自定义"))).toBe(false);
    expect(modes.find((mode) => mode.id === "auto-review")).toMatchObject({
      permissions: ":workspace",
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
    });
    expect(modes.find((mode) => mode.id === "full-access")).toMatchObject({
      permissions: ":danger-full-access",
      approvalPolicy: "never",
      approvalsReviewer: "user",
    });
  });

  it("可从线程设置恢复对应权限模式", () => {
    expect(
      permissionModeFromSettings(
        ":workspace",
        "on-request",
        "auto_review",
      ),
    ).toBe("auto-review");
    expect(
      permissionModeFromSettings(
        ":danger-full-access",
        "never",
        "user",
      ),
    ).toBe("full-access");
  });
});

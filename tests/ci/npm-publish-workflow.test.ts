import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

interface PublishWorkflow {
  on?: {
    workflow_call?: {
      inputs?: {
        app_version?: {
          required?: boolean;
          type?: string;
        };
      };
    };
  };
  permissions?: {
    contents?: string;
    "id-token"?: string;
  };
  jobs?: {
    publish?: {
      "runs-on"?: string;
      steps?: Array<{
        uses?: string;
        with?: Record<string, unknown>;
        run?: string;
        env?: Record<string, string>;
      }>;
    };
  };
}

describe("npm 自动发布流水线", () => {
  it("统一发布流水线传入版本后验证、构建并发布同版本 npm 包", () => {
    const source = readFileSync(
      ".github/workflows/publish-npm.yml",
      "utf8",
    );
    const workflow = parse(source) as PublishWorkflow;
    const steps = workflow.jobs?.publish?.steps ?? [];
    const script = steps.map((step) => step.run ?? "").join("\n");
    const publish = steps.find((step) =>
      step.run?.includes("npm publish"),
    );

    expect(workflow.on?.workflow_call?.inputs?.app_version).toMatchObject({
      required: true,
      type: "string",
    });
    expect(workflow.permissions).toMatchObject({
      contents: "read",
      "id-token": "write",
    });
    expect(workflow.jobs?.publish?.["runs-on"]).toBe("ubuntu-latest");
    expect(steps.some((step) => step.uses?.startsWith("actions/checkout@"))).toBe(
      true,
    );
    expect(
      steps.some(
        (step) =>
          step.uses?.startsWith("actions/setup-node@") &&
          step.with?.["node-version"] === "24" &&
          step.with?.["registry-url"] === "https://registry.npmjs.org",
      ),
    ).toBe(true);
    expect(script).toContain("npm ci");
    expect(script).toContain("npm test");
    expect(script).toContain("npm run build:package");
    expect(script).toContain("npm version");
    expect(source).toContain("inputs.app_version");
    expect(script).toContain("npm publish --access public");
    expect(script).not.toContain("--provenance");
    expect(publish?.env?.NODE_AUTH_TOKEN).toBeUndefined();
    expect(source).not.toContain("NPM_TOKEN");
  });
});

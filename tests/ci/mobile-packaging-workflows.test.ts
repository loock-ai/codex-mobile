import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

function readProjectFile(path: string) {
  return readFileSync(path, "utf8");
}

interface WorkflowStep {
  name?: string;
  run?: string;
}

interface Workflow {
  jobs: {
    build: {
      steps: WorkflowStep[];
    };
  };
}

function readWorkflow(path: string) {
  const source = readProjectFile(path);
  const workflow = parse(source) as Workflow;

  expect(workflow.jobs.build.steps).toBeInstanceOf(Array);
  return { source, workflow };
}

function readRunStep(workflow: Workflow, name: string) {
  const step = workflow.jobs.build.steps.find((candidate) => candidate.name === name);

  expect(step, `找不到流水线步骤：${name}`).toBeDefined();
  expect(step?.run, `流水线步骤没有 run 脚本：${name}`).toBeTypeOf("string");
  return step?.run ?? "";
}

function readAssetScanner(workflow: Workflow) {
  const buildFrontend = readRunStep(workflow, "Build embedded frontend");
  const match = buildFrontend.match(
    /scan-mobile-assets\.cjs" <<'NODE'\n([\s\S]*?)\nNODE\n/,
  );

  expect(match, "找不到移动资源扫描器 heredoc").not.toBeNull();
  return match?.[1] ?? "";
}

function runAssetScanner(scanner: string, source: string) {
  const directory = mkdtempSync(join(tmpdir(), "codex-mobile-scanner-"));
  const fixture = join(directory, "custom.js");
  writeFileSync(fixture, source);
  try {
    return spawnSync(process.execPath, ["-", fixture], {
      input: scanner,
      encoding: "utf8",
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("移动 App 内置前端流水线", () => {
  it("Vite 使用同时兼容 Web 与本地 WebView 的相对资源路径", () => {
    expect(readProjectFile("vite.config.ts")).toContain('base: "./"');
  });

  it("Android 只构建一个不绑定后端的 Codex Mobile App", () => {
    const { source, workflow } = readWorkflow(
      ".github/workflows/build-android.yml",
    );
    const buildFrontend = readRunStep(workflow, "Build embedded frontend");
    const hardenHost = readRunStep(
      workflow,
      "Harden and test embedded Android project",
    );
    const verifyArtifact = readRunStep(workflow, "Prepare and verify APK");
    const scanner = readAssetScanner(workflow);

    expect(buildFrontend).toContain("npm ci");
    expect(buildFrontend).toContain("npm run build");
    expect(buildFrontend).toContain("cp -R dist/. pakeplus/scripts/www/");
    expect(buildFrontend).toContain("allowedUrlPrefixes");
    expect(buildFrontend).toContain("authorization");
    expect(buildFrontend).toContain("bearer");
    expect(buildFrontend).toContain("169\\.254");
    expect(buildFrontend).toContain("::1");
    expect(runAssetScanner(scanner, 'const socket = "wss://gateway.example/ws";').status)
      .not.toBe(0);
    expect(
      runAssetScanner(
        scanner,
        'const token = "literal-secret-value"; const authorization = "Bearer abcdefghijklmnopqrstuvwxyz";',
      ).status,
    ).not.toBe(0);
    expect(
      runAssetScanner(
        scanner,
        'const docs = "https://react.dev/errors/"; const sample = "http://host.local:4173/?token=xxx"; const sentinel = "https://www.pakeplus.com/\0\b";',
      ).status,
    ).toBe(0);
    expect(hardenHost).toContain("app/src/main/assets/index.html");
    expect(hardenHost).toContain("allowed_permissions");
    expect(hardenHost).toContain('android:allowBackup="false"');
    expect(verifyArtifact).toContain("apkanalyzer manifest print");
    expect(verifyArtifact).toContain(
      "DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION",
    );
    expect(verifyArtifact).toContain("protectionLevel");
    expect(verifyArtifact).toContain('{"signature", "0x2"}');
    expect(verifyArtifact).toContain("CodexMobile-unpacked-assets");
    expect(verifyArtifact).toContain(
      'node "$RUNNER_TEMP/scan-mobile-assets.cjs" "$unpacked_assets/assets"',
    );
    expect(source).toContain(".android.isHtml = true");
    expect(source).toContain("vip.loock.codexmobile");
    expect(source).not.toContain("matrix:");
    expect(source).not.toContain("page_url");
    expect(source).not.toMatch(/192\.168\.\d+\.\d+/);
  });

  it("iOS 只构建一个内置同一份前端的 Codex Mobile App", () => {
    const { source, workflow } = readWorkflow(".github/workflows/build-ios.yml");
    const buildFrontend = readRunStep(workflow, "Build embedded frontend");
    const hardenHost = readRunStep(workflow, "Harden and test the iOS host");
    const verifyArtifact = readRunStep(
      workflow,
      "Prepare and verify unsigned IPA",
    );
    const scanner = readAssetScanner(workflow);

    expect(buildFrontend).toContain("npm ci");
    expect(buildFrontend).toContain("npm run build");
    expect(buildFrontend).toContain("cp -R dist/. pakeplus/scripts/www/");
    expect(buildFrontend).toContain("allowedUrlPrefixes");
    expect(buildFrontend).toContain("authorization");
    expect(buildFrontend).toContain("bearer");
    expect(buildFrontend).toContain("169\\.254");
    expect(buildFrontend).toContain("::1");
    expect(runAssetScanner(scanner, 'const socket = "ws://gateway.example/ws";').status)
      .not.toBe(0);
    expect(hardenHost).toContain("PakePlus/index.html");
    expect(hardenHost).toContain(
      "Delete :NSAppTransportSecurity:NSAllowsArbitraryLoads",
    );
    expect(hardenHost).toContain("Delete :UIBackgroundModes");
    expect(hardenHost).toContain("developerExtrasEnabled");
    expect(hardenHost).toContain("decisionHandler(.deny)");
    expect(hardenHost).toContain(
      'index_source.replace("./assets/", "./")',
    );
    expect(hardenHost).toContain(
      'node "$RUNNER_TEMP/scan-mobile-assets.cjs" PakePlus',
    );
    expect(verifyArtifact).toContain("Print :DEBUG");
    expect(verifyArtifact).toContain(":NSLocationWhenInUseUsageDescription");
    expect(verifyArtifact).toContain(":UIBackgroundModes");
    expect(verifyArtifact).toContain('find "$app" -maxdepth 1');
    expect(verifyArtifact).toContain(
      "Payload/PakePlus.app/index-.+\\.js",
    );
    expect(verifyArtifact).not.toContain('find "$app/assets"');
    expect(verifyArtifact).toContain("CodexMobile-ios-unpacked");
    expect(verifyArtifact).toContain(
      'node "$RUNNER_TEMP/scan-mobile-assets.cjs"',
    );
    expect(verifyArtifact).toContain('"$unpacked/Payload/PakePlus.app"');
    expect(source).toContain(".ios.isHtml = true");
    expect(source).toContain("vip.loock.codexmobile");
    expect(source).toContain("CODE_SIGNING_ALLOWED=NO");
    expect(source).not.toContain("page_url");
    expect(source).not.toMatch(/192\.168\.\d+\.\d+/);
  });
});

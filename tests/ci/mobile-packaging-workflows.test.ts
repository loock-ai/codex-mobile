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
  on?: {
    push?: {
      branches?: string[];
      paths?: string[];
    };
    release?: {
      types?: string[];
    };
    workflow_dispatch?: unknown;
  };
  concurrency?: {
    group?: string;
    "cancel-in-progress"?: boolean;
  };
  permissions?: {
    contents?: string;
  };
  jobs: {
    build: {
      outputs?: Record<string, string>;
      steps: WorkflowStep[];
    };
    release?: {
      if?: string;
      needs?: string;
      permissions?: {
        contents?: string;
      };
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

  it("移动图标合成后裁掉圆角矩形外侧透明留白", () => {
    const composer = readProjectFile("scripts/compose-mobile-app-icon.sh");

    expect(composer).toContain("crop=824:824:100:100");
    expect(composer).toContain("color=c=white:s=824x824");
    expect(composer).toContain(
      "fillborders=left=100:right=100:top=100:bottom=100:mode=smear",
    );
    expect(composer).toContain("geq=r=255:g=255:b=255:a='255*Y/103'");
    expect(composer).toContain("overlay=x=0:y=920");
    expect(composer).toContain("format=rgb24");
    expect(composer).toContain("scale=1024:1024:flags=lanczos");
  });

  it("Android 只构建一个不绑定后端的 Codex Mobile App", () => {
    const { source, workflow } = readWorkflow(
      ".github/workflows/build-android.yml",
    );
    const installIcon = readRunStep(
      workflow,
      "Install Codex Mobile app icon",
    );
    const buildFrontend = readRunStep(workflow, "Build embedded frontend");
    const hardenHost = readRunStep(
      workflow,
      "Harden and test embedded Android project",
    );
    const verifyArtifact = readRunStep(workflow, "Prepare and verify APK");
    const scanner = readAssetScanner(workflow);

    expect(installIcon).toContain(
      "docs/assets/app-icon/codex-mobile-app-icon-1024.png",
    );
    expect(installIcon).toContain("readUInt32BE(16) !== 1024");
    expect(installIcon).toContain('cp "$icon" pakeplus/app-icon.png');
    expect(installIcon).toContain('cmp "$icon" pakeplus/app-icon.png');
    expect(buildFrontend).toContain("npm ci");
    expect(buildFrontend).toContain("npm run build");
    expect(buildFrontend).toContain("cp -R dist/. pakeplus/scripts/www/");
    expect(buildFrontend).toContain("allowedUrlPrefixes");
    expect(buildFrontend).toContain("authorization");
    expect(buildFrontend).toContain("bearer");
    expect(buildFrontend).toContain("169\\.254");
    expect(buildFrontend).toContain("::1");
    expect(buildFrontend).toContain(
      "https://api.github.com/repos/loock-ai/codex-mobile/releases/",
    );
    expect(buildFrontend).toContain(
      "https://github.com/loock-ai/codex-mobile/releases/",
    );
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
        'const docs = "https://react.dev/errors/"; const sample = "http://host.local:18766/?token=xxx"; const sentinel = "https://www.pakeplus.com/\0\b";',
      ).status,
    ).toBe(0);
    expect(hardenHost).toContain("app/src/main/assets/index.html");
    expect(hardenHost).toContain("allowed_permissions");
    expect(source).toContain(".phone.camera = true");
    expect(hardenHost).toContain("android.permission.CAMERA");
    expect(hardenHost).toContain('android:allowBackup="false"');
    expect(hardenHost).toContain("enableEdgeToEdge()");
    expect(hardenHost).toContain(
      "view.setPadding(systemBar.left, 0, systemBar.right, systemBar.bottom)",
    );
    expect(hardenHost).toContain(
      "systemBar.top / resources.displayMetrics.density.toDouble()",
    );
    expect(hardenHost).toContain("nativeSafeAreaTopCssPx");
    expect(hardenHost).toContain("fun safeAreaTopCssPx(): Double");
    expect(hardenHost).toContain("evaluateJavascript");
    expect(hardenHost).toContain(".fullScreen == false");
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
    expect(source).toContain('.android.safeArea = "all"');
    expect(readProjectFile("src/styles.css")).not.toContain(
      "html.android-webview { --safe-area-top: 0px; }",
    );
    expect(readProjectFile("src/styles.css")).toContain(
      "--native-safe-area-top: 0px",
    );
    expect(readProjectFile("src/styles.css")).toContain(
      "--safe-area-top: max(env(safe-area-inset-top, 0px), var(--native-safe-area-top), var(--browser-edge-top))",
    );
    expect(readProjectFile("src/styles.css")).toContain(
      "html.native-webview { --browser-edge-top: 0px; --browser-edge-bottom: 0px; }",
    );
    expect(source).toContain("vip.loock.codexmobile");
    expect(source).not.toContain("matrix:");
    expect(source).not.toContain("page_url");
    expect(source).not.toMatch(/192\.168\.\d+\.\d+/);
  });

  it("Android 在 main 前端变更时自动递增版本并原子发布 Release", () => {
    const { source, workflow } = readWorkflow(
      ".github/workflows/build-android.yml",
    );
    expect(workflow.on?.push?.branches).toEqual(["main"]);
    expect(workflow.on?.push?.paths).toEqual(
      expect.arrayContaining([
        "src/**",
        "public/**",
        "index.html",
        "package.json",
        "package-lock.json",
        "vite.config.ts",
        "docs/assets/app-icon/codex-mobile-app-icon-1024.png",
        "scripts/compose-mobile-app-icon.sh",
        ".github/workflows/build-android.yml",
      ]),
    );
    expect(workflow.on).toHaveProperty("workflow_dispatch");
    expect(workflow.concurrency).toMatchObject({
      "cancel-in-progress": true,
    });
    expect(workflow.permissions?.contents).toBe("read");

    const resolveVersion = readRunStep(workflow, "Resolve app version");
    expect(resolveVersion).toContain("releases/latest");
    expect(resolveVersion).toContain("package.json");
    expect(resolveVersion).toContain("patch + 1");
    expect(resolveVersion).toContain("GITHUB_OUTPUT");
    expect(resolveVersion).toContain("GITHUB_ENV");
    expect(workflow.jobs.build.outputs).toHaveProperty("app_version");

    const hardenHost = readRunStep(
      workflow,
      "Harden and test embedded Android project",
    );
    expect(hardenHost).toContain("APP_VERSION_CODE");
    expect(hardenHost).toContain("versionCode =");
    expect(hardenHost).toContain("versionName =");

    const verifyArtifact = readRunStep(workflow, "Prepare and verify APK");
    expect(verifyArtifact).toContain("sha256sum");
    expect(verifyArtifact).toContain(".sha256");

    expect(workflow.jobs.release?.needs).toBe("build");
    expect(workflow.jobs.release?.permissions?.contents).toBe("write");
    expect(workflow.jobs.release?.if).toContain("github.event_name == 'push'");
    const publish = workflow.jobs.release?.steps.find(
      (step) => step.name === "Publish GitHub Release",
    )?.run;
    expect(publish).toContain("gh release create");
    expect(publish).toContain("--generate-notes");
    expect(publish).toContain("--draft");
    expect(publish).toContain("gh release edit");
    expect(publish).toContain("--draft=false");
    expect(publish).toContain("--cleanup-tag");
    expect(publish).toContain("CodexMobile-v");
    expect(source).toContain("actions/download-artifact@v4");
  });

  it("Android 更新桥限制下载来源、校验摘要并只增加安装权限", () => {
    const { source, workflow } = readWorkflow(
      ".github/workflows/build-android.yml",
    );
    const hardenHost = readRunStep(
      workflow,
      "Harden and test embedded Android project",
    );
    const verifyArtifact = readRunStep(workflow, "Prepare and verify APK");

    expect(hardenHost).toContain("REQUEST_INSTALL_PACKAGES");
    expect(hardenHost).toContain("FileProvider");
    expect(hardenHost).toContain("update_file_paths");
    expect(hardenHost).toContain(
      "https://github.com/loock-ai/codex-mobile/releases/download/",
    );
    expect(hardenHost).toContain("MessageDigest.getInstance(\"SHA-256\")");
    expect(hardenHost).toContain("fun appVersion(): String");
    expect(hardenHost).toContain("getPackageInfo");
    expect(hardenHost).toContain("fun installApk(");
    expect(hardenHost).toContain("codex-mobile-app-update");
    expect(hardenHost).toContain("canRequestPackageInstalls");
    expect(verifyArtifact).toContain("REQUEST_INSTALL_PACKAGES");
    expect(verifyArtifact).toContain(".fileprovider");
    expect(source).not.toMatch(
      /CODEX_MOBILE_TOKEN\s*:\s*[A-Za-z0-9._~+/%=-]{8,}/,
    );
  });

  it("iOS 只构建一个内置同一份前端的 Codex Mobile App", () => {
    const { source, workflow } = readWorkflow(".github/workflows/build-ios.yml");
    const installIcon = readRunStep(
      workflow,
      "Install Codex Mobile app icon",
    );
    const buildFrontend = readRunStep(workflow, "Build embedded frontend");
    const hardenHost = readRunStep(workflow, "Harden and test the iOS host");
    const verifyArtifact = readRunStep(
      workflow,
      "Prepare and verify unsigned IPA",
    );
    const scanner = readAssetScanner(workflow);

    expect(workflow.on?.release?.types).toContain("published");
    expect(workflow.on).toHaveProperty("workflow_dispatch");
    expect(workflow.concurrency).toMatchObject({
      "cancel-in-progress": true,
    });
    expect(installIcon).toContain(
      "docs/assets/app-icon/codex-mobile-app-icon-1024.png",
    );
    expect(installIcon).toContain("readUInt32BE(16) !== 1024");
    expect(installIcon).toContain('cp "$icon" pakeplus/app-icon.png');
    expect(installIcon).toContain('cmp "$icon" pakeplus/app-icon.png');
    expect(source).toContain(".phone.camera = true");
    expect(source).toContain("NSCameraUsageDescription");
    expect(source).toContain("Resolve app version");
    expect(source).toContain("github.event.release.tag_name");
    expect(source).not.toContain('APP_VERSION: "1.0.0"');
    expect(buildFrontend).toContain("npm ci");
    expect(buildFrontend).toContain("npm run build");
    expect(buildFrontend).toContain("cp -R dist/. pakeplus/scripts/www/");
    expect(buildFrontend).toContain("allowedUrlPrefixes");
    expect(buildFrontend).toContain("authorization");
    expect(buildFrontend).toContain("bearer");
    expect(buildFrontend).toContain("169\\.254");
    expect(buildFrontend).toContain("::1");
    expect(buildFrontend).toContain(
      "https://api.github.com/repos/loock-ai/codex-mobile/releases/",
    );
    expect(buildFrontend).toContain(
      "https://github.com/loock-ai/codex-mobile/releases/",
    );
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

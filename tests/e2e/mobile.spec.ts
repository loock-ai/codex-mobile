import { expect, test } from "@playwright/test";

test("移动端选择器、线程恢复、Markdown、折叠与吸顶", async ({ page }) => {
  const expectSheetHeaderFlush = async (sheetSelector: string) => {
    const offset = await page.locator(sheetSelector).evaluate((sheet) => {
      const header = sheet.querySelector(":scope > header");
      if (!header) return Number.POSITIVE_INFINITY;
      return Math.abs(
        header.getBoundingClientRect().top - sheet.getBoundingClientRect().top,
      );
    });
    expect(offset).toBeLessThanOrEqual(1);
  };

  await page.addInitScript(() => {
    const now = Math.floor(Date.now() / 1000);
    const longUserText =
      "# 用户标题\n\n**用户粗体**\n\n- 用户列表\n\n" +
      "请检查这个移动端界面，并参考附件中的视觉细节。\n".repeat(10);
    const nativeSetInterval = window.setInterval.bind(window);
    window.setInterval = ((
      handler: TimerHandler,
      timeout?: number,
      ...args: any[]
    ) =>
      nativeSetInterval(
        handler,
        timeout === 60_000 ? 250 : timeout,
        ...args,
      )) as typeof window.setInterval;
    (window as any).__rpcMessages = [];
    class MockSocket extends EventTarget {
      static OPEN = 1;
      static CLOSED = 3;
      readyState = 0;

      constructor() {
        super();
        setTimeout(() => {
          this.readyState = MockSocket.OPEN;
          this.dispatchEvent(new Event("open"));
        }, 0);
      }

      send(raw: string) {
        const request = JSON.parse(raw);
        (window as any).__rpcMessages.push(request);
        if (request.id == null) return;
        const responses: Record<string, unknown> = {
          initialize: {
            userAgent: "mock-app-server",
            codexHome: "/tmp/codex",
            platformFamily: "unix",
            platformOs: "macos",
          },
          "fs/readFile": request.params?.path?.endsWith(".png")
            ? {
                dataBase64:
                  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=",
              }
            : {
                dataBase64: btoa(
                  "import type { DraftImage } from './types';\n" +
                    "export const remoteFile = true;\n" +
                    "export const maxImages = 4;\n",
                ),
              },
          "model/list": {
            data: [
              {
                id: "terra-standard",
                model: "gpt-5.6-terra",
                displayName: "GPT-5.6-Terra",
                description: "均衡模型",
                isDefault: true,
                defaultReasoningEffort: "medium",
                supportedReasoningEfforts: [
                  { reasoningEffort: "low", description: "更快响应" },
                  { reasoningEffort: "medium", description: "平衡速度与质量" },
                  { reasoningEffort: "high", description: "更深入思考" },
                ],
                defaultServiceTier: null,
                serviceTiers: [],
              },
              {
                id: "terra-priority",
                model: "gpt-5.6-terra-priority",
                displayName: "GPT-5.6-Terra Priority",
                description: "低延迟通道",
                defaultReasoningEffort: "high",
                supportedReasoningEfforts: [
                  { reasoningEffort: "low", description: "更快响应" },
                  { reasoningEffort: "high", description: "更深入思考" },
                ],
                defaultServiceTier: null,
                serviceTiers: [
                  {
                    id: "priority",
                    name: "快速",
                    description: "1.5 倍速度，用量增加",
                  },
                ],
                additionalSpeedTiers: ["fast"],
              },
            ],
          },
          "permissionProfile/list": {
            data: [
              { id: ":workspace", description: "Workspace", allowed: true },
              { id: ":read-only", description: "Read only", allowed: true },
              {
                id: ":danger-full-access",
                description: "Full access",
                allowed: true,
              },
            ],
          },
          "config/read": {
            config: {
              model: "gpt-5.6-terra",
              model_reasoning_effort: "medium",
              service_tier: null,
              sandbox_mode: "workspace-write",
              approval_policy: "on-request",
              approvals_reviewer: "user",
            },
          },
          "thread/list": {
            data: [
              {
                id: "existing-thread",
                preview: "Markdown 会话",
                cwd: "/tmp/project",
                updatedAt: now - 120,
                status: { type: "active", activeFlags: [] },
              },
              {
                id: "idle-thread",
                preview: "空闲会话",
                cwd: "/tmp/project",
                updatedAt: now - 120,
                status: { type: "idle" },
              },
              ...Array.from({ length: 18 }, (_, index) => ({
                id: `history-${index}`,
                preview: `历史会话 ${index + 1}`,
                cwd: "/tmp/project",
                updatedAt: now - 3_600 - index * 60,
                status: { type: "idle" },
              })),
            ],
          },
          "thread/resume": {
            thread: {
              id: "existing-thread",
              preview: "Markdown 会话",
              cwd: "/tmp/project",
              turns: [
                ...Array.from({ length: 8 }, (_, index) => ({
                  id: `history-turn-${index}`,
                  status: "completed",
                  items: [
                    {
                      id: `history-user-${index}`,
                      type: "userMessage",
                      text: `历史问题 ${index + 1}`,
                    },
                    {
                      id: `history-agent-${index}`,
                      type: "agentMessage",
                      phase: "final_answer",
                      text: `历史回复 ${index + 1}`,
                    },
                  ],
                })),
                {
                  id: "turn-1",
                  status: "completed",
                  items: [
                    {
                      id: "u-1",
                      type: "userMessage",
                      content: [
                        { type: "text", text: longUserText },
                        { type: "localImage", path: "/tmp/user.png" },
                      ],
                    },
                    {
                      id: "a-0",
                      type: "agentMessage",
                      text: "我先检查界面和协议事件。",
                    },
                    {
                      id: "c-1",
                      type: "commandExecution",
                      status: "completed",
                      command: "sed -n '1,20p' src/App.tsx",
                      commandActions: [
                        {
                          type: "read",
                          name: "App.tsx",
                          path: "/tmp/project/src/App.tsx",
                        },
                      ],
                      cwd: "/tmp/project",
                      aggregatedOutput: Array.from(
                        { length: 80 },
                        (_, index) => `${index + 1}: test output`,
                      ).join("\n"),
                      exitCode: 0,
                    },
                    {
                      id: "f-1",
                      type: "fileChange",
                      status: "completed",
                      changes: [
                        {
                          path: "/tmp/project/src/App.tsx",
                          kind: "update",
                          diff:
                            "@@ -138,2 +138,3 @@\n turns: [\n+  ...historyTurns,\n-  oldTurn,\n+  currentTurn,",
                        },
                        {
                          path:
                            "/tmp/project/docs/plans/mobile-diff-design.md",
                          kind: "add",
                          diff: "@@ -0,0 +1 @@\n+# 移动端 Diff",
                        },
                      ],
                    },
                    {
                      id: "image-1",
                      type: "imageView",
                      path: "/tmp/ai.png",
                    },
                    {
                      id: "a-1",
                      type: "agentMessage",
                      phase: "final_answer",
                      text:
                        "**加粗内容**\n\n- 列表项\n\n`inline-code`\n\n" +
                        "[attachments.ts](/tmp/project/src/ui/attachments.ts:2) " +
                        "[OpenAI](https://openai.com)",
                    },
                  ],
                },
              ],
            },
            model: "gpt-5.6-terra",
            reasoningEffort: "medium",
            serviceTier: null,
            approvalPolicy: "on-request",
            approvalsReviewer: "user",
            activePermissionProfile: { id: ":workspace" },
          },
          "thread/start": {
            thread: {
              id: "new-thread",
              preview: "新对话",
              cwd: "/tmp/project",
              turns: [],
            },
            model: "gpt-5.6-terra-priority",
            reasoningEffort: "high",
            serviceTier: "priority",
            approvalPolicy: "on-request",
            approvalsReviewer: "auto_review",
            activePermissionProfile: { id: ":workspace" },
          },
          "turn/start": {
            turn: {
              id: "new-turn",
              status: "inProgress",
              items: [{ id: "u-new", type: "userMessage", text: "协议检查" }],
            },
          },
        };
        const responseDelay = request.method === "thread/list" ? 350 : 0;
        setTimeout(
          () =>
            this.dispatchEvent(
              new MessageEvent("message", {
                data: JSON.stringify({
                  id: request.id,
                  result: responses[request.method] ?? {},
                }),
              }),
            ),
          responseDelay,
        );
        if (request.method === "turn/start") {
          const threadId = request.params.threadId;
          setTimeout(() => {
            this.dispatchEvent(
              new MessageEvent("message", {
                data: JSON.stringify({
                  method: "turn/started",
                  params: {
                    threadId,
                    turn: {
                      id: "new-turn",
                      status: "inProgress",
                      items: [],
                    },
                  },
                }),
              }),
            );
          }, 20);
          setTimeout(() => {
            for (const item of [
              {
                id: "live-agent",
                type: "agentMessage",
                text: "正在检查实时过程。",
              },
              {
                id: "live-command",
                type: "commandExecution",
                status: "inProgress",
                command: "npm test",
              },
              {
                id: "live-final",
                type: "agentMessage",
                phase: "final_answer",
                text: "实时任务最终回复",
              },
            ]) {
              this.dispatchEvent(
                new MessageEvent("message", {
                  data: JSON.stringify({
                    method: "item/started",
                    params: { threadId, turnId: "new-turn", item },
                  }),
                }),
              );
            }
          }, 40);
          setTimeout(() => {
            this.dispatchEvent(
              new MessageEvent("message", {
                data: JSON.stringify({
                  method: "item/completed",
                  params: {
                    threadId,
                    turnId: "new-turn",
                    item: {
                      id: "live-command",
                      type: "commandExecution",
                      status: "completed",
                      command: "npm test",
                    },
                  },
                }),
              }),
            );
          }, 300);
          setTimeout(() => {
            this.dispatchEvent(
              new MessageEvent("message", {
                data: JSON.stringify({
                  method: "turn/completed",
                  params: {
                    threadId,
                    turn: {
                      id: "new-turn",
                      status: "completed",
                      items: [
                        {
                          id: "live-final",
                          type: "agentMessage",
                          phase: "final_answer",
                          text: "实时任务最终回复",
                        },
                      ],
                    },
                  },
                }),
              }),
            );
          }, 700);
        }
      }

      close() {
        this.readyState = MockSocket.CLOSED;
        this.dispatchEvent(new CloseEvent("close"));
      }
    }
    (window as any).WebSocket = MockSocket;
  });

  await page.goto("/");
  await expect(page.getByLabel("正在加载会话")).toBeVisible();
  await expect(page.getByText("暂无对话", { exact: true })).toHaveCount(0);
  await expect(page.getByText("2 分钟", { exact: true })).toBeVisible();
  await expect(page.getByLabel("正在加载会话")).toHaveCount(0);
  await expect(page.getByLabel("进行中", { exact: true })).toBeVisible();
  const listHeader = page.locator(".list-header");
  await expect(listHeader).toHaveCSS("position", "fixed");
  await expect(listHeader).toHaveCSS("top", "0px");
  await page.evaluate(() => window.scrollTo(0, 520));
  await expect
    .poll(async () => Math.round((await listHeader.boundingBox())?.y ?? -1))
    .toBe(0);
  await expect(listHeader.locator("h1")).toHaveCSS("font-size", "20px");
  await expect(page.locator(".thread-row").first()).toHaveCSS(
    "font-size",
    "16px",
  );
  await expect(page.locator(".thread-row").first()).toHaveCSS(
    "line-height",
    "32px",
  );
  await expect(page.locator(".thread-row").first()).toHaveCSS(
    "min-height",
    "auto",
  );
  await expect(page.locator(".round-button").first()).toHaveCSS(
    "width",
    "44px",
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).__rpcMessages.filter(
            (message: any) => message.method === "thread/list",
          ).length,
      ),
    )
    .toBeGreaterThan(1);
  await page.getByRole("button", { name: /Markdown 会话/ }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Math.round(
            document.documentElement.scrollHeight -
              window.scrollY -
              window.innerHeight,
          ),
      ),
    )
    .toBeLessThanOrEqual(1);

  await expect(page.locator(".assistant-message .markdown-body strong"))
    .toHaveText("加粗内容");
  await expect(page.locator(".assistant-message .markdown-body li"))
    .toHaveText("列表项");
  await expect(page.locator(".assistant-message .markdown-body code"))
    .toContainText("inline-code");
  const remoteFileLink = page.getByRole("link", { name: "attachments.ts" });
  await expect(remoteFileLink).toHaveAttribute(
    "href",
    "/tmp/project/src/ui/attachments.ts:2",
  );
  await remoteFileLink.click();
  await expect(page).toHaveURL("http://127.0.0.1:4173/");
  await expect(page.getByRole("heading", { name: "远程文件" })).toBeVisible();
  await expect(
    page.locator(
      ".remote-text-sheet .sheet-handle, .remote-text-sheet .sheet-handle-button",
    ),
  ).toHaveCount(0);
  await expect(
    page.locator(".remote-text-sheet > header").getByRole("button", {
      name: "关闭远程文件",
    }),
  ).toBeVisible();
  await expect(page.locator(".remote-text-sheet > header")).toHaveCSS(
    "position",
    "sticky",
  );
  await expect(page.locator(".remote-text-sheet > header")).toHaveCSS(
    "top",
    "0px",
  );
  await expectSheetHeaderFlush(".remote-text-sheet");
  await expect(page.getByText("export const remoteFile = true;", { exact: true }))
    .toBeVisible();
  await expect(page.locator(".remote-text-line.target")).toContainText(
    "export const remoteFile = true;",
  );
  await expect(
    page.getByText("/tmp/project/src/ui/attachments.ts:2", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".remote-text-sheet > footer .remote-file-path"),
  ).toHaveCSS("font-size", "11px");
  const remoteFileName = page.locator(".remote-text-file-name");
  await expect(remoteFileName).toContainText("attachments.ts");
  await expect(remoteFileName).toHaveCSS("font-size", "13px");
  const remoteFileNameBox = await remoteFileName.boundingBox();
  const remoteFileContentBox = await page
    .locator(".remote-text-content")
    .boundingBox();
  expect(remoteFileNameBox!.y + remoteFileNameBox!.height).toBeLessThanOrEqual(
    remoteFileContentBox!.y,
  );
  await expect(page.locator(".remote-text-sheet > footer strong")).toHaveCount(
    0,
  );
  const downloadFile = page.getByRole("link", { name: "下载文件" });
  await expect(downloadFile.locator("svg")).toBeVisible();
  await expect(downloadFile).not.toContainText("↓");
  await expect(
    page.locator('.remote-text-sheet button.sheet-close'),
  ).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__rpcMessages.some(
          (message: any) =>
            message.method === "fs/readFile" &&
            message.params.path === "/tmp/project/src/ui/attachments.ts",
        ),
      ),
    )
    .toBe(true);
  await page.getByRole("button", { name: "关闭远程文件" }).click();
  await expect(page.getByRole("link", { name: "OpenAI" })).toHaveAttribute(
    "href",
    "https://openai.com",
  );
  await expect(page.locator(".user-bubble .user-markdown h1")).toHaveText(
    "用户标题",
  );
  await expect(page.locator(".user-bubble .user-markdown strong")).toHaveText(
    "用户粗体",
  );
  await expect(page.locator(".user-bubble .user-markdown li")).toHaveText(
    "用户列表",
  );
  await expect(page.getByRole("button", { name: /展开更多/ })).toBeVisible();
  await page.getByRole("button", { name: /展开更多/ }).click();
  await expect(page.getByRole("button", { name: /收起/ })).toBeVisible();
  await expect(page.getByRole("img", { name: "user.png" })).toBeVisible();
  await expect(page.getByRole("img", { name: "ai.png" })).toHaveCount(0);
  await expect(page.getByText("我先检查界面和协议事件。")).toHaveCount(0);
  await page.getByRole("button", { name: "查看图片 user.png" }).click();
  await expect(page.getByRole("heading", { name: "远程文件" })).toBeVisible();
  await expect(
    page.locator(
      ".remote-file-sheet .sheet-handle, .remote-file-sheet .sheet-handle-button",
    ),
  ).toHaveCount(0);
  await expect(page.locator(".remote-file-sheet > header")).toHaveCSS(
    "position",
    "sticky",
  );
  await expect(page.locator(".remote-file-sheet > header")).toHaveCSS(
    "top",
    "0px",
  );
  await expectSheetHeaderFlush(".remote-file-sheet");
  await expect(page.getByText("/tmp/user.png", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "关闭远程文件" }).click();
  const previousMessages = page.getByRole("button", {
    name: /之前的 4 条消息/,
  });
  const previousChevron = previousMessages.locator(".chevron-icon");
  await expect(previousMessages).toHaveAttribute("aria-expanded", "false");
  await expect(previousChevron).toHaveClass(/direction-right/);
  const sharedChevronPath = await previousChevron.locator("path").getAttribute("d");
  await previousMessages.click();
  await expect(previousMessages).toHaveAttribute("aria-expanded", "true");
  await expect(previousChevron).toHaveClass(/direction-down/);
  await expect(previousChevron.locator("path")).toHaveAttribute(
    "d",
    sharedChevronPath!,
  );
  await expect(page.getByText("我先检查界面和协议事件。")).toBeVisible();
  await expect(page.getByRole("img", { name: "ai.png" })).toBeVisible();
  const activitySummary = page.locator(".tool-activity > summary");
  await expect(activitySummary).toContainText("已更改 2 个文件，已运行 1 个命令");
  await activitySummary.click();
  await page.getByRole("button", { name: "已读取 App.tsx", exact: true }).click();
  await expect(page.getByRole("heading", { name: "命令执行" })).toBeVisible();
  await expect(
    page.locator(
      ".tool-detail-sheet .sheet-handle, .tool-detail-sheet .sheet-handle-button",
    ),
  ).toHaveCount(0);
  const toolDetailClose = page.getByRole("button", {
    name: "关闭工具详情",
  });
  await expect(toolDetailClose).toHaveCSS("width", "44px");
  await expect(toolDetailClose).toHaveCSS("height", "44px");
  await expect(page.getByText("/tmp/project", { exact: true })).toBeVisible();
  const toolDetailHeader = page.locator(".tool-detail-sheet > header");
  const toolDetailSheet = page.locator(".tool-detail-sheet");
  await expect(toolDetailHeader).toHaveCSS("position", "sticky");
  await expect(toolDetailHeader).toHaveCSS("top", "0px");
  await expectSheetHeaderFlush(".tool-detail-sheet");
  await toolDetailSheet.evaluate((element) => {
    element.scrollTop = 160;
  });
  await page.waitForTimeout(50);
  const toolHeaderTop = Math.round(
    (await toolDetailHeader.boundingBox())?.y ?? -1,
  );
  await toolDetailSheet.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect
    .poll(async () =>
      Math.round((await toolDetailHeader.boundingBox())?.y ?? -1),
    )
    .toBe(toolHeaderTop);
  await toolDetailClose.click();
  await page
    .getByRole("button", { name: "已编辑 2 个文件", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "已更改 2 个文件" }))
    .toBeVisible();
  await expect(
    page.locator(
      ".file-diff-sheet .sheet-handle, .file-diff-sheet .sheet-handle-button",
    ),
  ).toHaveCount(0);
  await expect(page.locator(".file-diff-sheet > header")).toHaveCSS(
    "position",
    "sticky",
  );
  await expect(page.locator(".file-diff-sheet > header")).toHaveCSS(
    "top",
    "0px",
  );
  await expectSheetHeaderFlush(".file-diff-sheet");
  const appDiff = page.getByRole("button", { name: /App\.tsx.*\+2.*-1/ });
  await expect(appDiff).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".file-diff-line.addition")).toHaveCount(2);
  await expect(page.locator(".file-diff-line.deletion")).toHaveCount(1);
  await expect(page.getByText("138", { exact: true }).first()).toBeVisible();
  const designDiff = page.getByRole("button", {
    name: /mobile-diff-design\.md.*\+1/,
  });
  await expect(designDiff).toHaveAttribute("aria-expanded", "false");
  await designDiff.click();
  await expect(designDiff).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText("# 移动端 Diff", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "关闭文件修改" }).click();
  const conversationWidths = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(conversationWidths.document).toBeLessThanOrEqual(
    conversationWidths.viewport,
  );
  expect(conversationWidths.body).toBeLessThanOrEqual(
    conversationWidths.viewport,
  );
  await expect(page.getByRole("button", { name: "选择审批与权限模式" }))
    .toContainText("默认权限");
  await expect(page.locator(".conversation-header")).toHaveCSS("position", "sticky");
  await expect(page.locator(".conversation-header")).toHaveCSS("top", "0px");

  await previousMessages.click();
  await expect(previousMessages).toHaveAttribute("aria-expanded", "false");
  await expect(previousChevron).toHaveClass(/direction-right/);
  await expect(page.getByRole("img", { name: "ai.png" })).toHaveCount(0);
  await expect(page.locator(".assistant-message .markdown-body strong"))
    .toHaveText("加粗内容");

  await page.getByRole("textbox", { name: "向 Codex 提问" }).fill("继续检查");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("正在检查实时过程。")).toBeVisible();
  await expect(page.getByText("实时任务最终回复")).toBeVisible();
  await expect(page.getByText(/正在运行 1 个命令/)).toBeVisible();
  await expect(previousMessages).toHaveAttribute("aria-expanded", "false");
  const completedLiveMessages = page.getByRole("button", {
    name: /之前的 2 条消息/,
  });
  await expect(completedLiveMessages).toBeVisible();
  await expect(page.getByText("实时任务最终回复")).toBeVisible();
  await expect(page.getByText("正在检查实时过程。")).toHaveCount(0);
  await expect(previousMessages).toHaveAttribute("aria-expanded", "false");

  await page.getByRole("button", { name: "返回" }).click();
  await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(0);
  await expect(
    page.getByRole("button", { name: /Markdown 会话/ }),
  ).toBeInViewport();
  await page.getByRole("button", { name: "聊天", exact: true }).click();

  const modelSettingsButton = page.getByRole("button", {
    name: "选择模型、智能与速度",
  });
  await expect(modelSettingsButton).not.toContainText("⚡");
  await modelSettingsButton.click();
  await expect(page.getByText("智能", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /高.*更深入思考/ })).toBeVisible();
  await expect(page.getByText("超高", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: /高.*更深入思考/ }).click();

  await page.getByRole("button", { name: "选择模型、智能与速度" }).click();
  await page.getByRole("button", { name: /模型.*GPT-5.6-Terra/ }).click();
  await page.getByRole("button", { name: /GPT-5.6-Terra Priority/ }).click();

  await modelSettingsButton.click();
  await page.getByRole("button", { name: /速度.*正常/ }).click();
  await page.getByRole("button", { name: /快速.*1.5 倍速度/ }).click();
  await expect(modelSettingsButton).toContainText("⚡");

  await page.getByRole("button", { name: "选择审批与权限模式" }).click();
  await expect(page.getByRole("button", { name: /默认权限/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /自动审核/ })).toBeVisible();
  await expect(page.getByText(/自定义/)).toHaveCount(0);
  await page.getByRole("button", { name: /自动审核/ }).click();

  const imageInput = page.getByLabel("选择图片");
  await imageInput.setInputFiles({
    name: "tiny.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await expect(page.getByRole("img", { name: "待发送 tiny.png" })).toBeVisible();
  const removeImage = page.getByRole("button", { name: "移除 tiny.png" });
  const removeImageBox = await removeImage.boundingBox();
  expect(removeImageBox?.width).toBeGreaterThanOrEqual(44);
  expect(removeImageBox?.height).toBeGreaterThanOrEqual(44);
  await removeImage.click();
  await expect(page.getByRole("img", { name: "待发送 tiny.png" })).toHaveCount(0);
  await imageInput.setInputFiles({
    name: "tiny.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await page.getByRole("textbox", { name: "向 Codex 提问" }).fill("协议检查");
  await page.getByRole("button", { name: "发送" }).click();

  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__rpcMessages.some(
          (message: any) =>
            message.method === "turn/start" &&
            message.params.threadId === "new-thread",
        ),
      ),
    )
    .toBe(true);
  const sent = await page.evaluate(() => (window as any).__rpcMessages);
  const threadStart = sent.find((message: any) => message.method === "thread/start");
  const turnStart = sent.find(
    (message: any) =>
      message.method === "turn/start" &&
      message.params.threadId === "new-thread",
  );
  expect(threadStart.params).toMatchObject({
    model: "gpt-5.6-terra-priority",
    serviceTier: "priority",
    permissions: ":workspace",
    approvalPolicy: "on-request",
    approvalsReviewer: "auto_review",
  });
  expect(threadStart.params).not.toHaveProperty("effort");
  expect(turnStart.params).toMatchObject({
    model: "gpt-5.6-terra-priority",
    effort: "high",
    serviceTier: "priority",
    permissions: ":workspace",
    approvalPolicy: "on-request",
    approvalsReviewer: "auto_review",
  });
  expect(turnStart.params.input).toEqual([
    { type: "text", text: "协议检查", text_elements: [] },
    {
      type: "image",
      url: expect.stringMatching(/^data:image\/png;base64,/),
    },
  ]);
  const widths = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
  expect(widths.body).toBeLessThanOrEqual(widths.viewport);
});

test("多设备同时连接、切换、缓存并路由后台审批", async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem("codex-mobile.backend-registry.v1")) {
      localStorage.setItem(
        "codex-mobile.backend-registry.v1",
        JSON.stringify({
        version: 1,
        selectedBackendId: "mini",
        backends: [
          {
            id: "mini",
            name: "Mac mini",
            baseUrl: "http://mini.test:4173",
            token: "mini-token",
            enabled: true,
            order: 0,
          },
          {
            id: "macbook",
            name: "MacBook",
            baseUrl: "http://macbook.test:4173",
            token: "macbook-token",
            enabled: true,
            order: 1,
          },
        ],
        }),
      );
    }
    (window as any).__backendMessages = [];
    (window as any).__backendSockets = [];
    (window as any).__backendSocketInstances = [];
    const nativeFetch = window.fetch.bind(window);
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url,
      );
      if (url.hostname.endsWith(".test") && url.pathname === "/api/host") {
        const hostId = url.hostname.replace(".test", "");
        return Promise.resolve(
          new Response(
            JSON.stringify({
              hostId,
              displayName: hostId,
              hostname: url.hostname,
              gatewayVersion: "0.2.0",
              appServerReady: true,
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          ),
        );
      }
      return nativeFetch(input, init);
    }) as typeof window.fetch;
    class MultiBackendSocket extends EventTarget {
      static OPEN = 1;
      static CLOSED = 3;
      readyState = 0;
      host: string;

      constructor(rawUrl: string) {
        super();
        this.host = new URL(rawUrl).hostname;
        (window as any).__backendSockets.push(this.host);
        (window as any).__backendSocketInstances.push(this);
        setTimeout(() => {
          this.readyState = MultiBackendSocket.OPEN;
          this.dispatchEvent(new Event("open"));
        }, 0);
      }

      send(raw: string) {
        const request = JSON.parse(raw);
        (window as any).__backendMessages.push({
          host: this.host,
          message: request,
        });
        if (request.id == null) return;
        const prefix = this.host === "mini.test" ? "Mini" : "MacBook";
        const responses: Record<string, unknown> = {
          initialize: {
            userAgent: `${prefix}-mock`,
            codexHome: "/tmp/codex",
            platformFamily: "unix",
            platformOs: "macos",
          },
          "model/list": {
            data: [
              {
                id: "default",
                model: "gpt-test",
                displayName: "GPT Test",
                isDefault: true,
                supportedReasoningEfforts: [],
                serviceTiers: [],
              },
            ],
          },
          "permissionProfile/list": {
            data: [{ id: ":workspace", allowed: true }],
          },
          "config/read": {
            config: {
              model: "gpt-test",
              sandbox_mode: "workspace-write",
            },
          },
          "thread/list": {
            data: [
              {
                id: `${prefix.toLowerCase()}-thread`,
                preview: `${prefix} 任务`,
                updatedAt: Math.floor(Date.now() / 1000),
                status:
                  this.host === "mini.test"
                    ? { type: "active", activeFlags: ["waitingOnApproval"] }
                    : { type: "idle" },
              },
            ],
          },
        };
        setTimeout(() => {
          this.dispatchEvent(
            new MessageEvent("message", {
              data: JSON.stringify({
                id: request.id,
                result: responses[request.method] ?? {},
              }),
            }),
          );
        }, 0);
        if (
          this.host === "macbook.test" &&
          request.method === "thread/list"
        ) {
          setTimeout(() => {
            this.dispatchEvent(
              new MessageEvent("message", {
                data: JSON.stringify({
                  id: "approval-1",
                  method: "item/commandExecution/requestApproval",
                  params: { command: "npm test" },
                }),
              }),
            );
          }, 80);
        }
      }

      close() {
        this.readyState = MultiBackendSocket.CLOSED;
        this.dispatchEvent(new CloseEvent("close"));
      }
    }
    (window as any).WebSocket = MultiBackendSocket;
  });

  await page.goto("/");
  await expect(page.getByRole("button", { name: /Mac mini.*进行中/ }))
    .toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => new Set((window as any).__backendSockets).size,
      ),
    )
    .toBe(2);
  await expect(page.getByRole("button", { name: /Mini 任务/ })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "MacBook 有 1 个待审批" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "MacBook 有 1 个待审批" }).click();
  await expect(page.getByRole("button", { name: /MacBook.*1 个待审批/ }))
    .toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: /MacBook 任务/ })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "允许运行此操作？" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "允许", exact: true }).click();

  await expect
    .poll(() =>
      page.evaluate(() => {
        const responses = (window as any).__backendMessages.filter(
          (entry: any) => entry.message.id === "approval-1",
        );
        return responses.map((entry: any) => entry.host);
      }),
    )
    .toEqual(["macbook.test"]);

  await page.getByRole("button", { name: "管理设备", exact: true }).click();
  await page.getByRole("button", { name: "添加设备" }).click();
  await page.getByLabel("设备名称").fill("Studio Mac");
  await page.getByLabel("网关地址").fill("http://studio.test:4173");
  await page.getByLabel("访问口令").fill("studio-token");
  await page.getByRole("button", { name: "测试并保存" }).click();
  await expect(page.getByRole("heading", { name: "管理设备" })).toBeVisible();
  await page.getByRole("button", { name: "关闭" }).click();
  await expect(page.getByRole("button", { name: /Studio Mac.*已连接/ }))
    .toBeVisible();

  await page.evaluate(() => {
    const miniSocket = (window as any).__backendSocketInstances.find(
      (socket: any) =>
        socket.host === "mini.test" &&
        socket.readyState === (window as any).WebSocket.OPEN,
    );
    miniSocket.close();
  });
  await expect(page.getByRole("button", { name: /MacBook 任务/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /MacBook.*已连接/ }))
    .toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).__backendSockets.filter(
            (host: string) => host === "mini.test",
          ).length,
      ),
    )
    .toBeGreaterThan(1);
  await page.getByRole("button", { name: /Mac mini.*已连接/ }).click();
  await expect(page.getByRole("button", { name: /Mini 任务/ })).toBeVisible();
  await page.getByRole("button", { name: /MacBook.*已连接/ }).click();

  await page.reload();
  await expect(page.getByRole("button", { name: /MacBook 任务/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /MacBook.*已连接/ }))
    .toHaveAttribute("aria-pressed", "true");
  const widths = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
  expect(widths.body).toBeLessThanOrEqual(widths.viewport);
});

test("移动端可连接真实 app-server 并进入新对话", async ({ page }) => {
  test.setTimeout(130_000);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Remote" })).toBeVisible();
  await expect(page.getByText("已连接", { exact: false })).toBeVisible();
  await expect(page.getByPlaceholder("搜索聊天")).toBeVisible();

  await page.getByRole("button", { name: "聊天", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "向 Codex 提问" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "选择审批与权限模式" }),
  ).toBeVisible();

  await page.getByRole("textbox", { name: "向 Codex 提问" }).fill(
    "只回复 E2E_OK，不要调用任何工具。",
  );
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByText("E2E_OK", { exact: true })).toBeVisible({
    timeout: 120_000,
  });
});

test("新会话启动期间返回列表不会被迟到响应重新拉回且任务保持进行中", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const now = Math.floor(Date.now() / 1000);
    class DelayedStartSocket extends EventTarget {
      static OPEN = 1;
      static CLOSED = 3;
      readyState = 0;

      constructor() {
        super();
        setTimeout(() => {
          this.readyState = DelayedStartSocket.OPEN;
          this.dispatchEvent(new Event("open"));
        }, 0);
      }

      send(raw: string) {
        const request = JSON.parse(raw);
        if (request.id == null) return;
        const responses: Record<string, unknown> = {
          initialize: {},
          "model/list": {
            data: [
              {
                model: "gpt-test",
                displayName: "GPT Test",
                isDefault: true,
                supportedReasoningEfforts: [],
                serviceTiers: [],
              },
            ],
          },
          "permissionProfile/list": {
            data: [{ id: ":workspace", allowed: true }],
          },
          "config/read": { config: { sandbox_mode: "workspace-write" } },
          "thread/list": {
            data: [
              {
                id: "existing",
                preview: "已有会话",
                updatedAt: now,
                status: { type: "idle" },
              },
            ],
          },
          "thread/start": {
            thread: {
              id: "delayed-thread",
              preview: "延迟启动的任务",
              updatedAt: now + 1,
              turns: [],
            },
          },
          "turn/start": {
            turn: {
              id: "delayed-turn",
              status: "inProgress",
              items: [],
            },
          },
        };
        const delay = request.method === "thread/start" ? 180 : 0;
        setTimeout(() => {
          this.dispatchEvent(
            new MessageEvent("message", {
              data: JSON.stringify({
                id: request.id,
                result: responses[request.method] ?? {},
              }),
            }),
          );
        }, delay);
        if (request.method === "turn/start") {
          setTimeout(() => {
            this.dispatchEvent(
              new MessageEvent("message", {
                data: JSON.stringify({
                  method: "turn/started",
                  params: {
                    threadId: "delayed-thread",
                    turn: {
                      id: "delayed-turn",
                      status: "inProgress",
                      items: [],
                    },
                  },
                }),
              }),
            );
          }, 20);
        }
      }

      close() {
        this.readyState = DelayedStartSocket.CLOSED;
        this.dispatchEvent(new CloseEvent("close"));
      }
    }
    (window as any).WebSocket = DelayedStartSocket;
  });

  await page.goto("/");
  await expect(page.getByRole("button", { name: "已有会话" })).toBeVisible();
  await page.getByRole("button", { name: "聊天", exact: true }).click();
  await page.getByRole("textbox", { name: "向 Codex 提问" }).fill("开始任务");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.getByRole("button", { name: "返回" }).click();

  await expect(page.getByPlaceholder("搜索聊天")).toBeVisible();
  const delayedThread = page.getByRole("button", {
    name: /延迟启动的任务.*进行中/,
  });
  await expect(delayedThread).toBeVisible();
  await page.waitForTimeout(250);
  await expect(page.getByPlaceholder("搜索聊天")).toBeVisible();
  await expect(delayedThread).toBeVisible();
});

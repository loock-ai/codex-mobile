import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Ajv from "ajv";
import { describe, expect, it } from "vitest";

const schema = JSON.parse(
  readFileSync(
    resolve(
      process.cwd(),
      "protocol/app-server-v2/codex_app_server_protocol.v2.schemas.json",
    ),
    "utf8",
  ),
);
const serverRequestSchema = JSON.parse(
  readFileSync(
    resolve(
      process.cwd(),
      "protocol/app-server-v2/generated-local/codex-cli-0.144.1/schema/ServerRequest.json",
    ),
    "utf8",
  ),
);

describe("app-server V2 Schema", () => {
  it("是有效 JSON Schema 并包含 Mobile MVP 所需方法", () => {
    const ajv = new Ajv({ strict: false });
    expect(() => ajv.compile(schema)).not.toThrow();

    const serialized = JSON.stringify(schema);
    for (const method of [
      "initialize",
      "thread/list",
      "thread/read",
      "thread/start",
      "turn/start",
      "turn/interrupt",
      "turn/diff/updated",
    ]) {
      expect(serialized).toContain(`"${method}"`);
    }
    const serverRequests = JSON.stringify(serverRequestSchema);
    expect(serverRequests).toContain('"item/commandExecution/requestApproval"');
    expect(serverRequests).toContain('"item/fileChange/requestApproval"');
  });
});

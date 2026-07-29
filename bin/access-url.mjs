import { readFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";

function addressPriority(address) {
  if (address.startsWith("192.168.")) return 0;
  if (address.startsWith("10.")) return 1;
  const match = /^172\.(\d+)\./.exec(address);
  if (match && Number(match[1]) >= 16 && Number(match[1]) <= 31) return 2;
  return 3;
}

export function findLanIPv4(interfaces = networkInterfaces()) {
  const addresses = Object.values(interfaces)
    .flatMap((entries) => entries ?? [])
    .filter(
      (entry) =>
        entry.family === "IPv4" &&
        !entry.internal &&
        entry.address !== "0.0.0.0",
    )
    .map((entry) => entry.address);

  addresses.sort((left, right) => {
    const priority = addressPriority(left) - addressPriority(right);
    return priority || left.localeCompare(right);
  });
  return addresses[0] ?? null;
}

export function createAccessUrl({
  host,
  port,
  token,
  lanIp,
}) {
  if (!token) {
    throw new Error("请先配置 CODEX_MOBILE_TOKEN 访问口令");
  }
  const address =
    host && !["0.0.0.0", "127.0.0.1", "::", "::1", "localhost"].includes(host)
      ? host
      : lanIp;
  if (!address) {
    throw new Error("未找到可用的局域网 IPv4 地址");
  }
  const url = new URL(`http://${address}:${port}/`);
  url.searchParams.set("token", token);
  return url.href;
}

export async function readRuntimeAccess(file) {
  try {
    const value = JSON.parse(await readFile(file, "utf8"));
    const port = Number(value?.port);
    const token = typeof value?.token === "string" ? value.token : "";
    if (!Number.isInteger(port) || port < 1 || port > 65535 || !token) {
      return null;
    }
    return { port: String(port), token };
  } catch {
    return null;
  }
}

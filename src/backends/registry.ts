import type {
  BackendConfig,
  BackendRegistry,
} from "./types";

export const BACKEND_REGISTRY_STORAGE_KEY =
  "codex-mobile.backend-registry.v1";
export const MAX_BACKENDS = 8;

export function parseBackendGatewayUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("网关地址无效");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("网关地址仅支持 HTTP 或 HTTPS");
  }
  if (url.username || url.password) {
    throw new Error("网关地址不能包含用户名或密码");
  }
  if ((url.pathname && url.pathname !== "/") || url.hash) {
    throw new Error("网关地址不能包含路径或锚点");
  }
  const unsupportedParameters = [...url.searchParams.keys()].filter(
    (key) => key !== "token",
  );
  if (unsupportedParameters.length) {
    throw new Error("网关地址仅支持 token 查询参数");
  }
  if (url.searchParams.getAll("token").length > 1) {
    throw new Error("网关地址只能包含一个 token");
  }
  return {
    baseUrl: url.origin,
    token: url.searchParams.get("token")?.trim() ?? "",
  };
}

export function formatBackendGatewayUrl(baseUrl: string, token: string) {
  const url = new URL(normalizeBackendBaseUrl(baseUrl));
  if (token) url.searchParams.set("token", token);
  return url.toString();
}

export function normalizeBackendBaseUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("后端地址无效");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("后端地址仅支持 HTTP 或 HTTPS");
  }
  if (
    (url.pathname && url.pathname !== "/") ||
    url.search ||
    url.hash
  ) {
    throw new Error("后端地址不能包含路径、查询参数或锚点");
  }
  if (url.username || url.password) {
    throw new Error("后端地址不能包含用户名或密码");
  }
  return url.origin;
}

export function createDefaultBackendRegistry(
  origin: string,
  token = "",
): BackendRegistry {
  const baseUrl = normalizeBackendBaseUrl(origin);
  return {
    version: 1,
    selectedBackendId: "current-origin",
    backends: [
      {
        id: "current-origin",
        name: new URL(baseUrl).hostname,
        baseUrl,
        token,
        enabled: true,
        order: 0,
      },
    ],
  };
}

function createInitialBackendRegistry(
  origin: string,
  token = "",
): BackendRegistry {
  let url: URL;
  try {
    url = new URL(origin.trim());
  } catch {
    return {
      version: 1,
      selectedBackendId: "",
      backends: [],
    };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return {
      version: 1,
      selectedBackendId: "",
      backends: [],
    };
  }
  return createDefaultBackendRegistry(origin, token);
}

function normalizedBackends(value: unknown) {
  if (!Array.isArray(value)) return [];
  const seenIds = new Set<string>();
  const seenUrls = new Set<string>();
  const seenHostIds = new Set<string>();
  const result: BackendConfig[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") continue;
    const source = candidate as Partial<BackendConfig>;
    const id = typeof source.id === "string" ? source.id.trim() : "";
    if (!id || seenIds.has(id)) continue;
    let baseUrl: string;
    try {
      baseUrl = normalizeBackendBaseUrl(String(source.baseUrl ?? ""));
    } catch {
      continue;
    }
    if (seenUrls.has(baseUrl)) continue;
    const hostId =
      typeof source.hostId === "string" ? source.hostId.trim() : "";
    if (hostId && seenHostIds.has(hostId)) continue;
    const order =
      typeof source.order === "number" && Number.isFinite(source.order)
        ? source.order
        : result.length;
    result.push({
      id,
      ...(hostId ? { hostId } : {}),
      name:
        typeof source.name === "string" && source.name.trim()
          ? source.name.trim()
          : new URL(baseUrl).hostname,
      baseUrl,
      token: typeof source.token === "string" ? source.token : "",
      enabled: source.enabled !== false,
      order,
    });
    seenIds.add(id);
    seenUrls.add(baseUrl);
    if (hostId) seenHostIds.add(hostId);
    if (result.length >= MAX_BACKENDS) break;
  }
  return result
    .sort((left, right) => left.order - right.order)
    .map((backend, order) => ({ ...backend, order }));
}

export function assignBackendHostId(
  registry: BackendRegistry,
  backendId: string,
  value: string,
): BackendRegistry {
  const hostId = value.trim();
  if (!hostId) return registry;
  const target = registry.backends.find((backend) => backend.id === backendId);
  if (!target) return registry;
  const candidates = registry.backends
    .filter(
      (backend) =>
        backend.id === backendId || backend.hostId === hostId,
    )
    .sort(
      (left, right) =>
        Number(right.enabled) - Number(left.enabled) ||
        left.order - right.order,
    );
  const canonical = candidates[0] ?? target;
  const duplicateIds = new Set(
    candidates
      .filter((backend) => backend.id !== canonical.id)
      .map((backend) => backend.id),
  );
  const backends = registry.backends
    .filter((backend) => !duplicateIds.has(backend.id))
    .map((backend) =>
      backend.id === canonical.id ? { ...backend, hostId } : backend,
    )
    .sort((left, right) => left.order - right.order)
    .map((backend, order) => ({ ...backend, order }));
  const selectedBackendId = duplicateIds.has(registry.selectedBackendId)
    ? canonical.id
    : registry.selectedBackendId;
  const unchanged =
    duplicateIds.size === 0 &&
    target.hostId === hostId &&
    selectedBackendId === registry.selectedBackendId;
  return unchanged
    ? registry
    : {
        ...registry,
        selectedBackendId,
        backends,
      };
}

function normalizedRegistry(
  value: unknown,
  origin: string,
): BackendRegistry {
  if (!value || typeof value !== "object") {
    return createInitialBackendRegistry(origin);
  }
  const source = value as Partial<BackendRegistry>;
  let backends = normalizedBackends(source.backends);
  if (!backends.length) return createInitialBackendRegistry(origin);
  if (!backends.some((backend) => backend.enabled)) {
    backends = backends.map((backend, index) =>
      index === 0 ? { ...backend, enabled: true } : backend,
    );
  }
  const requested =
    typeof source.selectedBackendId === "string"
      ? source.selectedBackendId
      : "";
  const selectedBackendId = backends.some(
    (backend) => backend.id === requested && backend.enabled,
  )
    ? requested
    : (backends.find((backend) => backend.enabled) ?? backends[0]).id;
  return {
    version: 1,
    selectedBackendId,
    backends,
  };
}

export function loadBackendRegistry(
  storage: Storage,
  origin: string,
  fallbackToken = "",
): BackendRegistry {
  const stored = storage.getItem(BACKEND_REGISTRY_STORAGE_KEY);
  if (!stored) return createInitialBackendRegistry(origin, fallbackToken);
  try {
    return normalizedRegistry(JSON.parse(stored), origin);
  } catch {
    return createInitialBackendRegistry(origin, fallbackToken);
  }
}

export function saveBackendRegistry(
  storage: Storage,
  registry: BackendRegistry,
) {
  if (!registry.backends.length) {
    storage.setItem(
      BACKEND_REGISTRY_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        selectedBackendId: "",
        backends: [],
      }),
    );
    return;
  }
  const fallbackOrigin = registry.backends[0].baseUrl;
  storage.setItem(
    BACKEND_REGISTRY_STORAGE_KEY,
    JSON.stringify(normalizedRegistry(registry, fallbackOrigin)),
  );
}

export function upsertBackend(
  registry: BackendRegistry,
  value: BackendConfig,
): BackendRegistry {
  const baseUrl = normalizeBackendBaseUrl(value.baseUrl);
  const existingIndex = registry.backends.findIndex(
    (backend) => backend.id === value.id,
  );
  if (
    registry.backends.some(
      (backend, index) =>
        index !== existingIndex && backend.baseUrl === baseUrl,
    )
  ) {
    throw new Error("后端地址已存在");
  }
  const hostId = value.hostId?.trim();
  if (
    hostId &&
    registry.backends.some(
      (backend, index) =>
        index !== existingIndex && backend.hostId === hostId,
    )
  ) {
    throw new Error("设备身份已存在");
  }
  if (existingIndex < 0 && registry.backends.length >= MAX_BACKENDS) {
    throw new Error(`最多只能保存 ${MAX_BACKENDS} 个后端`);
  }
  const next: BackendConfig = {
    id: value.id.trim(),
    ...(hostId ? { hostId } : {}),
    name: value.name.trim() || new URL(baseUrl).hostname,
    baseUrl,
    token: value.token,
    enabled: value.enabled,
    order: value.order,
  };
  if (!next.id) throw new Error("后端 ID 不能为空");
  const backends =
    existingIndex >= 0
      ? registry.backends.map((backend, index) =>
          index === existingIndex ? next : backend,
        )
      : [...registry.backends, next];
  const sorted = backends
    .sort((left, right) => left.order - right.order)
    .map((backend, order) => ({ ...backend, order }));
  return {
    version: 1,
    selectedBackendId: registry.selectedBackendId || sorted[0].id,
    backends: sorted,
  };
}

function withValidSelection(
  registry: BackendRegistry,
  backends: BackendConfig[],
): BackendRegistry {
  const normalized = backends.map((backend, order) => ({
    ...backend,
    order,
  }));
  const selectedBackendId = normalized.some(
    (backend) =>
      backend.id === registry.selectedBackendId && backend.enabled,
  )
    ? registry.selectedBackendId
    : (normalized.find((backend) => backend.enabled) ?? normalized[0]).id;
  return {
    version: 1,
    selectedBackendId,
    backends: normalized,
  };
}

export function setBackendEnabled(
  registry: BackendRegistry,
  backendId: string,
  enabled: boolean,
): BackendRegistry {
  const target = registry.backends.find(
    (backend) => backend.id === backendId,
  );
  if (!target || target.enabled === enabled) return registry;
  if (
    !enabled &&
    !registry.backends.some(
      (backend) => backend.id !== backendId && backend.enabled,
    )
  ) {
    throw new Error("至少保留一个已启用设备");
  }
  return withValidSelection(
    registry,
    registry.backends.map((backend) =>
      backend.id === backendId ? { ...backend, enabled } : backend,
    ),
  );
}

export function removeBackend(
  registry: BackendRegistry,
  backendId: string,
): BackendRegistry {
  if (!registry.backends.some((backend) => backend.id === backendId)) {
    return registry;
  }
  if (registry.backends.length <= 1) {
    throw new Error("至少保留一个设备");
  }
  const backends = registry.backends.filter(
    (backend) => backend.id !== backendId,
  );
  if (!backends.some((backend) => backend.enabled)) {
    const first = backends[0];
    backends[0] = { ...first, enabled: true };
  }
  return withValidSelection(registry, backends);
}

export function moveBackend(
  registry: BackendRegistry,
  backendId: string,
  offset: -1 | 1,
): BackendRegistry {
  const index = registry.backends.findIndex(
    (backend) => backend.id === backendId,
  );
  if (index < 0) return registry;
  const targetIndex = Math.max(
    0,
    Math.min(registry.backends.length - 1, index + offset),
  );
  if (targetIndex === index) return registry;
  const backends = [...registry.backends];
  const [backend] = backends.splice(index, 1);
  backends.splice(targetIndex, 0, backend);
  return withValidSelection(registry, backends);
}

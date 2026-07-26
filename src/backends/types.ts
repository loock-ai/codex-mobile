export interface BackendConfig {
  id: string;
  hostId?: string;
  name: string;
  baseUrl: string;
  token: string;
  enabled: boolean;
  order: number;
}

export interface BackendRegistry {
  version: 1;
  selectedBackendId: string;
  backends: BackendConfig[];
}

export interface BackendRuntimeSummary {
  backendId: string;
  connection: "connecting" | "online" | "offline";
  busy: boolean;
  approvalCount: number;
  error: string;
}

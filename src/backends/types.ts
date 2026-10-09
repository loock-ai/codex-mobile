export interface DesktopHost { hostId: string; displayName: string }

export interface BackendConfig {
  desktopHosts?: DesktopHost[];
  visibleHostIds?: string[];
  id: string;
  hostId?: string;
  remoteProjects?: boolean;
  /** 运行时远程设备身份，不持久化到设备注册表。 */
  desktopHostId?: string;
  parentBackendId?: string;
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

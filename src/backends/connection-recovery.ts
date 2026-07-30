import type { AppServerClient } from "../app-server/client";

interface VisibilityTarget extends EventTarget {
  visibilityState: DocumentVisibilityState;
}

interface ConnectionRecoveryOptions {
  documentTarget?: VisibilityTarget;
  windowTarget?: EventTarget;
  reconnect: () => void | Promise<void>;
}

export async function reconnectAndWaitUntilReady(
  reconnect: () => void,
  isReady: () => boolean,
  wait: () => Promise<void> = () =>
    new Promise((resolve) => globalThis.setTimeout(resolve, 100)),
  maxChecks = 100,
) {
  reconnect();
  for (let check = 0; check < maxChecks && !isReady(); check += 1) {
    await wait();
  }
}

export async function recoverBackendConnection(
  client: AppServerClient | null,
  reconnect: () => void | Promise<void>,
  reconcile: (client: AppServerClient) => void | Promise<void> = () =>
    undefined,
) {
  if (!client) {
    await reconnect();
    return;
  }
  try {
    await client.request(
      "thread/list",
      { limit: 1, sortKey: "updated_at" },
      { timeoutMs: 2_500 },
    );
  } catch {
    await reconnect();
    return;
  }
  try {
    await reconcile(client);
  } catch {
    // A snapshot failure does not prove that the transport is unhealthy.
    // Keep the live connection and let the next foreground/manual refresh retry.
  }
}

export function bindConnectionRecovery({
  documentTarget = document,
  windowTarget = window,
  reconnect,
}: ConnectionRecoveryOptions) {
  let wasHidden = documentTarget.visibilityState === "hidden";
  let recoveryPromise: Promise<void> | null = null;

  const requestRecovery = () => {
    if (recoveryPromise) return;
    recoveryPromise = Promise.resolve(reconnect()).finally(() => {
      recoveryPromise = null;
    });
  };
  const onVisibilityChange = () => {
    if (documentTarget.visibilityState === "hidden") {
      wasHidden = true;
      return;
    }
    if (!wasHidden) return;
    wasHidden = false;
    requestRecovery();
  };
  const onPageShow = (event: Event) => {
    if (!(event as PageTransitionEvent).persisted) return;
    requestRecovery();
  };
  const onOnline = () => requestRecovery();

  documentTarget.addEventListener("visibilitychange", onVisibilityChange);
  windowTarget.addEventListener("pageshow", onPageShow);
  windowTarget.addEventListener("online", onOnline);

  return () => {
    documentTarget.removeEventListener(
      "visibilitychange",
      onVisibilityChange,
    );
    windowTarget.removeEventListener("pageshow", onPageShow);
    windowTarget.removeEventListener("online", onOnline);
  };
}

export type ConnectionState = "connecting" | "online" | "offline";
export type ThreadListState = "loading" | "ready" | "error";
export type DisplayRecord = Record<string, any>;

export function titleOf(thread: DisplayRecord) {
  return thread.name || thread.preview || "新对话";
}

export function AppIcon({
  name,
}: {
  name: "back" | "search" | "compose" | "send" | "stop" | "more";
}) {
  const paths = {
    back: <path d="M15 18l-6-6 6-6M9 12h11" />,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
    compose: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 013 3L8 18l-4 1 1-4z" /></>,
    send: <><path d="m5 12 7-7 7 7" /><path d="M12 19V5" /></>,
    stop: <rect x="7" y="7" width="10" height="10" rx="2" />,
    more: <><circle cx="12" cy="5" r="1.2" fill="currentColor" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /><circle cx="12" cy="19" r="1.2" fill="currentColor" /></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

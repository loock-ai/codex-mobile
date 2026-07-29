export type ConnectionState = "connecting" | "online" | "offline";
export type ThreadListState = "loading" | "ready" | "error";
export type DisplayRecord = Record<string, any>;

export function titleOf(thread: DisplayRecord) {
  return thread.name || thread.preview || "新对话";
}

export function AppIcon({
  name,
}: {
  name:
    | "archive"
    | "back"
    | "close"
    | "compose"
    | "copy"
    | "download"
    | "folder"
    | "folder-open"
    | "menu"
    | "more"
    | "pin"
    | "refresh"
    | "rename"
    | "search"
    | "send"
    | "stop";
}) {
  const paths = {
    archive: <><path d="M4 7h16v13H4z" /><path d="M3 4h18v3H3zM9 11h6" /></>,
    back: <path d="M15 18l-6-6 6-6M9 12h11" />,
    close: <path d="m7 7 10 10M17 7 7 17" />,
    copy: <><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2" /></>,
  download: <><path d="M12 4v11" /><path d="m7.5 11 4.5 4.5 4.5-4.5" /></>,
    folder: <path d="M3 7a2 2 0 012-2h5l2 2h7a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />,
    "folder-open": <><path d="M3 10V7a2 2 0 012-2h5l2 2h7a2 2 0 012 2v1" /><path d="M3 10h18l-2 9H5a2 2 0 01-2-2z" /></>,
    menu: <path d="M5 7h14M5 12h14M5 17h14" />,
    pin: <><path d="m14 4 6 6-3 1-4 4-1 5-2-2-4-4-2-2 5-1 4-4z" /><path d="m9 15-5 5" /></>,
    refresh: <><path d="M20 6v5h-5" /><path d="M19 11a7 7 0 1 0 .2 4" /></>,
    rename: <><path d="M4 20h4l11-11a2.8 2.8 0 00-4-4L4 16z" /><path d="m13.5 6.5 4 4" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
    compose: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 013 3L8 18l-4 1 1-4z" /></>,
    send: <><path d="m5 12 7-7 7 7" /><path d="M12 19V5" /></>,
    stop: <rect x="7" y="7" width="10" height="10" rx="2" />,
    more: <><circle cx="12" cy="5" r="1.2" fill="currentColor" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /><circle cx="12" cy="19" r="1.2" fill="currentColor" /></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" data-icon={name}>{paths[name]}</svg>;
}

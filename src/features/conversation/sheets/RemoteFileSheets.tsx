import {
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { AppServerClient } from "../../../app-server/client";
import {
  parseRemoteFileHref,
  type ImageSource,
} from "../../../ui/conversation";

function downloadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}

function imageMime(source: string) {
  const extension = source.split(/[?#]/)[0]?.split(".").at(-1)?.toLowerCase();
  return (
    {
      avif: "image/avif",
      gif: "image/gif",
      jpeg: "image/jpeg",
      jpg: "image/jpeg",
      png: "image/png",
      svg: "image/svg+xml",
      webp: "image/webp",
    }[extension ?? ""] ?? "image/png"
  );
}

function formatImageSize(bytes: number | null) {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function decodeBase64File(dataBase64: string) {
  const binary = window.atob(dataBase64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const text = new TextDecoder("utf-8").decode(bytes);
  const replacementCount = Array.from(text).filter(
    (character) => character === "\uFFFD",
  ).length;
  return {
    bytes: bytes.byteLength,
    text,
    binary:
      bytes.includes(0) ||
      (text.length > 0 && replacementCount / text.length > 0.02),
  };
}

export function RemoteImage({
  image,
  client,
  alt,
}: {
  image: ImageSource;
  client: AppServerClient | null;
  alt?: string;
}) {
  const [src, setSrc] = useState(image.local ? "" : image.source);
  const [size, setSize] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    if (!image.local) {
      setSrc(image.source);
      setSize(null);
      return () => {
        cancelled = true;
      };
    }
    setSrc("");
    if (!client) return;
    void client
      .request<{ dataBase64: string }>("fs/readFile", { path: image.source })
      .then((result) => {
        if (cancelled) return;
        setSize(Math.floor((result.dataBase64.length * 3) / 4));
        setSrc(`data:${imageMime(image.source)};base64,${result.dataBase64}`);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [client, image.local, image.source]);

  if (failed) {
    return <div className="image-load-error">无法读取 {image.name}</div>;
  }
  if (!src) return <div className="image-placeholder" aria-label={`正在加载 ${image.name}`} />;

  return (
    <>
      <button
        type="button"
        className="message-image-button"
        aria-label={`查看图片 ${image.name}`}
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
      >
        <img src={src} alt={alt || image.name} />
      </button>
      {open && (
        <div
          className="remote-file-backdrop"
          onClick={(event) => {
            event.stopPropagation();
            setOpen(false);
          }}
        >
          <section
            className="remote-file-sheet"
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <h3>远程文件</h3>
              <a href={src} download={image.name} aria-label="下载图片">
                {downloadIcon()}
              </a>
            </header>
            <img className="remote-file-preview" src={src} alt={alt || image.name} />
            <p><strong>{image.name}</strong>{size != null ? ` (${formatImageSize(size)})` : ""}</p>
            <p className="remote-file-path">{image.source}</p>
            <button
              type="button"
              className="sheet-close"
              aria-label="关闭远程文件"
              onClick={() => setOpen(false)}
            >
              完成
            </button>
          </section>
        </div>
      )}
    </>
  );
}

function RemoteTextFileSheet({
  href,
  path,
  line,
  client,
  onClose,
}: {
  href: string;
  path: string;
  line: number | null;
  client: AppServerClient | null;
  onClose: () => void;
}) {
  const [state, setState] = useState<{
    status: "loading" | "ready" | "error";
    text: string;
    dataBase64: string;
    bytes: number | null;
    binary: boolean;
    error: string;
  }>({
    status: "loading",
    text: "",
    dataBase64: "",
    bytes: null,
    binary: false,
    error: "",
  });
  const targetLineRef = useRef<HTMLDivElement | null>(null);
  const name = path.split("/").filter(Boolean).at(-1) || "远程文件";

  useEffect(() => {
    let cancelled = false;
    setState({
      status: "loading",
      text: "",
      dataBase64: "",
      bytes: null,
      binary: false,
      error: "",
    });
    if (!client) {
      setState((current) => ({
        ...current,
        status: "error",
        error: "尚未连接 app-server",
      }));
      return () => {
        cancelled = true;
      };
    }
    void client
      .request<{ dataBase64: string }>("fs/readFile", { path })
      .then((result) => {
        if (cancelled) return;
        const decoded = decodeBase64File(result.dataBase64);
        setState({
          status: "ready",
          text: decoded.text,
          dataBase64: result.dataBase64,
          bytes: decoded.bytes,
          binary: decoded.binary,
          error: "",
        });
      })
      .catch((reason) => {
        if (cancelled) return;
        setState((current) => ({
          ...current,
          status: "error",
          error: reason instanceof Error ? reason.message : String(reason),
        }));
      });
    return () => {
      cancelled = true;
    };
  }, [client, path]);

  useEffect(() => {
    if (state.status !== "ready" || line == null) return;
    targetLineRef.current?.scrollIntoView({ block: "center" });
  }, [line, state.status]);

  const lines = state.text.split("\n");
  if (lines.at(-1) === "") lines.pop();

  return (
    <div className="remote-file-backdrop" onClick={onClose}>
      <section
        className="remote-text-sheet"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <h3>远程文件</h3>
          <div className="remote-text-actions">
            {state.dataBase64 && (
              <a
                href={`data:text/plain;charset=utf-8;base64,${state.dataBase64}`}
                download={name}
                aria-label="下载文件"
              >
                {downloadIcon()}
              </a>
            )}
            <button
              type="button"
              aria-label="关闭远程文件"
              onClick={onClose}
            >
              ×
            </button>
          </div>
        </header>
        <div className="remote-text-file-name">
          <strong>{name}</strong>
          {state.bytes != null ? ` (${formatImageSize(state.bytes)})` : ""}
        </div>
        <div className="remote-text-content">
          {state.status === "loading" && (
            <div className="remote-text-status" role="status">
              正在读取文件…
            </div>
          )}
          {state.status === "error" && (
            <div className="remote-text-status error" role="alert">
              无法读取文件：{state.error}
            </div>
          )}
          {state.status === "ready" && state.binary && (
            <div className="remote-text-status">
              这是二进制文件，无法作为文本预览
            </div>
          )}
          {state.status === "ready" && !state.binary && !lines.length && (
            <div className="remote-text-status">文件内容为空</div>
          )}
          {state.status === "ready" &&
            !state.binary &&
            lines.map((content, index) => {
              const lineNumber = index + 1;
              const target = lineNumber === line;
              return (
                <div
                  className={`remote-text-line${target ? " target" : ""}`}
                  key={lineNumber}
                  ref={target ? targetLineRef : undefined}
                >
                  <span>{lineNumber}</span>
                  <code>{content || " "}</code>
                </div>
              );
            })}
        </div>
        <footer>
          <p className="remote-file-path">{href}</p>
        </footer>
      </section>
    </div>
  );
}

export function RemoteFileLink({
  href,
  children,
  client,
}: {
  href: string;
  children: ReactNode;
  client: AppServerClient | null;
}) {
  const target = parseRemoteFileHref(href);
  const [open, setOpen] = useState(false);
  if (!target) return <a href={href}>{children}</a>;
  return (
    <>
      <a
        href={href}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
        }}
      >
        {children}
      </a>
      {open &&
        createPortal(
          <RemoteTextFileSheet
            href={href}
            path={target.path}
            line={target.line}
            client={client}
            onClose={() => setOpen(false)}
          />,
          document.body,
        )}
    </>
  );
}

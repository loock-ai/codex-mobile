type ThreadRecord = Record<string, any>;

interface ThreadListClient {
  request(method: string, params: unknown): Promise<any>;
}

export type ProjectThreadLoadState = "idle" | "loading" | "ready" | "error";

interface ThreadListLoaderCallbacks {
  onData?: (threads: ThreadRecord[]) => void;
  onProjectStart?: (cwd: string) => void;
  onProjectData?: (cwd: string, threads: ThreadRecord[]) => void;
  onProjectError?: (cwd: string, reason: Error) => void;
  onSettled?: () => void;
}

export function createLatestThreadListLoader(
  callbacks: ThreadListLoaderCallbacks,
) {
  let pending:
    | { client: ThreadListClient; promise: Promise<void> }
    | null = null;
  let latestSequence = 0;
  const projectAttempts = new Map<string, number>();

  const nextProjectAttempt = (cwd: string) => {
    const attempt = (projectAttempts.get(cwd) ?? 0) + 1;
    projectAttempts.set(cwd, attempt);
    return attempt;
  };

  const loadProject = (
    client: ThreadListClient,
    cwd: string,
    sequence = latestSequence,
  ) => {
    const attempt = nextProjectAttempt(cwd);
    callbacks.onProjectStart?.(cwd);
    return client
      .request("thread/list", {
        limit: 5,
        cwd,
        sortKey: "updated_at",
      })
      .then((result: { data: ThreadRecord[] }) => {
        if (
          sequence === latestSequence &&
          projectAttempts.get(cwd) === attempt
        ) {
          callbacks.onProjectData?.(cwd, result.data);
        }
      })
      .catch((reason: unknown) => {
        if (
          sequence === latestSequence &&
          projectAttempts.get(cwd) === attempt
        ) {
          callbacks.onProjectError?.(
            cwd,
            reason instanceof Error ? reason : new Error(String(reason)),
          );
        }
      });
  };

  return {
    load(client: ThreadListClient, projects: string[] = []) {
      if (pending?.client === client) return pending.promise;

      const sequence = ++latestSequence;
      const request = projects.length
        ? Promise.all(projects.map((cwd) => loadProject(client, cwd, sequence)))
        : client
            .request("thread/list", {
              limit: 50,
              sortKey: "updated_at",
            })
            .then((result: { data: ThreadRecord[] }) => {
              if (sequence === latestSequence) callbacks.onData?.(result.data);
            });
      const promise = request
        .then(() => {
          if (sequence === latestSequence) callbacks.onSettled?.();
        })
        .finally(() => {
          if (pending?.promise === promise) pending = null;
        });

      pending = { client, promise };
      return promise;
    },
    loadProject(client: ThreadListClient, cwd: string) {
      return loadProject(client, cwd);
    },
  };
}

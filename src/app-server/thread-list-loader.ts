type ThreadRecord = Record<string, any>;

interface ThreadListClient {
  request(method: string, params: unknown): Promise<any>;
}

export function createLatestThreadListLoader(
  onData: (threads: ThreadRecord[]) => void,
) {
  let pending:
    | { client: ThreadListClient; promise: Promise<void> }
    | null = null;
  let latestSequence = 0;

  return {
    load(client: ThreadListClient) {
      if (pending?.client === client) return pending.promise;

      const sequence = ++latestSequence;
      const promise = client
        .request("thread/list", {
          limit: 50,
          sortKey: "updated_at",
        })
        .then((result: { data: ThreadRecord[] }) => {
          if (sequence === latestSequence) onData(result.data);
        })
        .finally(() => {
          if (pending?.promise === promise) pending = null;
        });

      pending = { client, promise };
      return promise;
    },
  };
}

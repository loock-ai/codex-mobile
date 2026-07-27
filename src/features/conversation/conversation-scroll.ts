import {
  type UIEventHandler,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

export const conversationBottomThreshold = 80;

export function isConversationNearBottom(
  target: Pick<HTMLElement, "scrollHeight" | "clientHeight" | "scrollTop">,
  threshold = conversationBottomThreshold,
) {
  return (
    target.scrollHeight - target.clientHeight - target.scrollTop <= threshold
  );
}

export function useConversationAutoScroll({
  threadId,
  contentRevision,
  ready,
}: {
  threadId: string;
  contentRevision: unknown;
  ready: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const followingRef = useRef(true);
  const frameRef = useRef<number | null>(null);
  const prependScrollHeightRef = useRef<number | null>(null);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

  const scrollToLatest = useCallback(() => {
    const target = scrollRef.current;
    if (!target) return;
    followingRef.current = true;
    target.scrollTop = target.scrollHeight;
    setShowJumpToLatest(false);
  }, []);

  const scheduleScrollToLatest = useCallback(() => {
    if (frameRef.current != null) {
      window.cancelAnimationFrame(frameRef.current);
    }
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      if (followingRef.current) scrollToLatest();
    });
  }, [scrollToLatest]);

  const onScroll = useCallback<UIEventHandler<HTMLDivElement>>((event) => {
    const following = isConversationNearBottom(event.currentTarget);
    followingRef.current = following;
    setShowJumpToLatest(!following);
  }, []);

  const beginPrependPreservation = useCallback(() => {
    const target = scrollRef.current;
    if (!target) return;
    followingRef.current = false;
    prependScrollHeightRef.current = target.scrollHeight;
  }, []);

  const cancelPrependPreservation = useCallback(() => {
    prependScrollHeightRef.current = null;
  }, []);

  useLayoutEffect(() => {
    followingRef.current = true;
    prependScrollHeightRef.current = null;
    setShowJumpToLatest(false);
    if (ready) scheduleScrollToLatest();
  }, [ready, scheduleScrollToLatest, threadId]);

  useLayoutEffect(() => {
    const target = scrollRef.current;
    if (target && prependScrollHeightRef.current != null) {
      const previousScrollHeight = prependScrollHeightRef.current;
      prependScrollHeightRef.current = null;
      target.scrollTop += target.scrollHeight - previousScrollHeight;
      return;
    }
    if (ready && followingRef.current) scheduleScrollToLatest();
  }, [contentRevision, ready, scheduleScrollToLatest]);

  useEffect(() => {
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (followingRef.current) scheduleScrollToLatest();
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [scheduleScrollToLatest, threadId]);

  useEffect(
    () => () => {
      if (frameRef.current != null) {
        window.cancelAnimationFrame(frameRef.current);
      }
    },
    [],
  );

  return {
    scrollRef,
    contentRef,
    onScroll,
    scrollToLatest,
    showJumpToLatest,
    beginPrependPreservation,
    cancelPrependPreservation,
  };
}

import { fireEvent, render, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  isConversationNearBottom,
  useConversationAutoScroll,
} from "../../src/features/conversation/conversation-scroll";

function ScrollHarness({
  revision,
  threadId = "thread-1",
}: {
  revision: number;
  threadId?: string;
}) {
  const {
    scrollRef,
    contentRef,
    onScroll,
    beginPrependPreservation,
  } = useConversationAutoScroll({
    threadId,
    contentRevision: revision,
    ready: true,
  });
  return (
    <>
      <div data-testid="scroller" ref={scrollRef} onScroll={onScroll}>
        <div ref={contentRef}>{revision}</div>
      </div>
      <button onClick={beginPrependPreservation}>准备插入旧消息</button>
    </>
  );
}

function setScrollMetrics(
  element: HTMLElement,
  {
    scrollHeight,
    clientHeight,
    scrollTop,
  }: {
    scrollHeight: number;
    clientHeight: number;
    scrollTop: number;
  },
) {
  Object.defineProperties(element, {
    scrollHeight: { configurable: true, value: scrollHeight },
    clientHeight: { configurable: true, value: clientHeight },
    scrollTop: { configurable: true, value: scrollTop, writable: true },
  });
}

describe("对话流式滚动跟随", () => {
  it("使用 80px 阈值判断是否接近底部", () => {
    expect(
      isConversationNearBottom({
        scrollHeight: 500,
        clientHeight: 200,
        scrollTop: 220,
      }),
    ).toBe(true);
    expect(
      isConversationNearBottom({
        scrollHeight: 500,
        clientHeight: 200,
        scrollTop: 100,
      }),
    ).toBe(false);
  });

  it("内容增长时跟随底部，用户上滑后暂停并可恢复", () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const { getByTestId, rerender } = render(
      <ScrollHarness revision={1} />,
    );
    const scroller = getByTestId("scroller");
    setScrollMetrics(scroller, {
      scrollHeight: 500,
      clientHeight: 200,
      scrollTop: 220,
    });

    rerender(<ScrollHarness revision={2} />);
    expect(scroller.scrollTop).toBe(500);

    scroller.scrollTop = 100;
    fireEvent.scroll(scroller);

    rerender(<ScrollHarness revision={3} />);
    expect(scroller.scrollTop).toBe(100);

    scroller.scrollTop = 220;
    fireEvent.scroll(scroller);
    rerender(<ScrollHarness revision={4} />);
    expect(scroller.scrollTop).toBe(500);
  });

  it("向前插入旧消息后用高度差保持当前阅读位置", () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const { container, rerender } = render(
      <ScrollHarness revision={1} />,
    );
    const view = within(container);
    const scroller = view.getByTestId("scroller");
    setScrollMetrics(scroller, {
      scrollHeight: 500,
      clientHeight: 200,
      scrollTop: 20,
    });
    fireEvent.scroll(scroller);
    fireEvent.click(view.getByText("准备插入旧消息"));

    setScrollMetrics(scroller, {
      scrollHeight: 700,
      clientHeight: 200,
      scrollTop: 20,
    });
    rerender(<ScrollHarness revision={2} />);

    expect(scroller.scrollTop).toBe(220);
  });
});

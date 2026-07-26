import type { SVGProps } from "react";

export type ChevronDirection = "right" | "down" | "up" | "left";

export function Chevron({
  direction = "right",
  className = "",
  ...props
}: SVGProps<SVGSVGElement> & { direction?: ChevronDirection }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={`chevron-icon direction-${direction} ${className}`.trim()}
      {...props}
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

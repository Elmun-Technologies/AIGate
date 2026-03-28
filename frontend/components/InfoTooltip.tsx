"use client";

import { useEffect, useRef, useState } from "react";

type InfoTooltipProps = {
  text: string;
};

export default function InfoTooltip({ text }: InfoTooltipProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const onClickOutside = (event: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  return (
    <span
      ref={rootRef}
      className="info-tip"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className="info-tip-trigger"
        onClick={() => setOpen((prev) => !prev)}
        aria-label="How it works"
      >
        ⓘ
      </button>
      {open ? (
        <span className="info-tip-popover" role="tooltip">
          {text}
          <span className="info-tip-arrow" />
        </span>
      ) : null}
    </span>
  );
}

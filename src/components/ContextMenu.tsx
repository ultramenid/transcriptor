import { useEffect, useRef } from "react";

export interface MenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
  separator?: false;
}
export interface MenuSeparator {
  separator: true;
}
export type MenuEntry = MenuItem | MenuSeparator;

interface Props {
  x: number;
  y: number;
  items: MenuEntry[];
  onClose: () => void;
}

export default function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function onScroll() {
      onClose();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("blur", onClose);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  // Keep the menu inside the viewport.
  const left = Math.min(x, window.innerWidth - 168);
  const top = Math.min(y, window.innerHeight - items.length * 36 - 16);

  return (
    <div
      ref={ref}
      role="menu"
      style={{ left, top }}
      className="fixed z-[70] w-40 overflow-hidden rounded-md border border-border-subtle bg-panel py-1 shadow-2xl"
    >
      {items.map((it, i) =>
        "separator" in it && it.separator ? (
          <div key={i} className="my-1 h-px bg-border-subtle" />
        ) : (
          <button
            key={i}
            role="menuitem"
            onClick={() => {
              (it as MenuItem).onClick();
              onClose();
            }}
            className={`flex w-full items-center px-3 py-1.5 text-left text-sm transition-colors ${
              (it as MenuItem).danger
                ? "text-ink hover:bg-panel-2"
                : "text-ink-muted hover:bg-panel-2 hover:text-ink"
            }`}
          >
            {(it as MenuItem).label}
          </button>
        ),
      )}
    </div>
  );
}
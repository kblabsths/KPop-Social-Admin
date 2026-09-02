import type { ReactNode } from "react";

/**
 * A page: the h1 in `title` type, 16px padding, 16px between sections.
 * LOOK_AND_FEEL: `title` is page h1 and section h2, nothing else.
 */
export function Page({
  title,
  actions,
  children,
}: {
  title: string;
  /** At most one primary Button per screen (LOOK_AND_FEEL, Buttons). */
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="type-title text-ink">{title}</h1>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}

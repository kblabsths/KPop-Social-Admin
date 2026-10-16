import type { ButtonHTMLAttributes } from "react";
import { cx } from "./cx";

/**
 * `body` sans, 4px radius, 6/12 padding.
 *
 * - **One primary per screen**: accent fill, on-accent text.
 * - Everything else is secondary: 1px hairline border, transparent fill.
 * - An action that writes canonical or settles an item is `destructive`: red
 *   border and red text, **never a red fill**.
 * - Disabled = 50% opacity, `not-allowed` cursor, and the label does not
 *   change — a working button never becomes "…".
 *
 * Every button label is a verb plus its object naming what gets written
 * ("Choose this value"), which is the caller's job, not this component's.
 */
export type ButtonVariant = "primary" | "secondary" | "destructive";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-accent text-on-accent",
  secondary: "border border-hairline text-ink",
  destructive: "border border-broken text-broken",
};

export function Button({
  variant = "secondary",
  className,
  disabled,
  type = "button",
  ...rest
}: { variant?: ButtonVariant } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled}
      className={cx(
        "type-body rounded-control px-3 py-1.5 transition-colors",
        VARIANT[variant],
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
    />
  );
}

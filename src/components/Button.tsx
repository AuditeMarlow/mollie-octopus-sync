import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "danger";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export function Button({ variant = "primary", className, ...rest }: Props) {
  const cls = [
    "btn",
    variant === "secondary" ? "btn--secondary" : null,
    variant === "danger" ? "btn--danger" : null,
    className ?? null,
  ]
    .filter(Boolean)
    .join(" ");
  return <button {...rest} className={cls} />;
}

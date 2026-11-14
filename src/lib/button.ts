// Button looks, shared by client buttons and server-rendered links styled as buttons.
const VARIANTS = {
  default: "border-transparent bg-foreground text-background hover:bg-foreground/85",
  outline: "border-border bg-transparent text-foreground hover:bg-secondary",
  ghost: "border-transparent text-muted-foreground hover:bg-secondary hover:text-foreground aria-expanded:bg-secondary",
  destructive: "border-destructive/40 bg-transparent text-destructive hover:bg-destructive/10",
};

const SIZES = {
  default: "h-[34px] gap-2 px-4",
  sm: "h-7 gap-1.5 px-3 text-xs [&_svg]:size-3.5",
  icon: "size-[34px]",
  "icon-sm": "size-8",
};

export function buttonClass(variant: ButtonVariant = "default", size: ButtonSize = "default") {
  return `inline-flex shrink-0 items-center justify-center rounded-lg border text-[13px] font-medium whitespace-nowrap transition-[color,background-color,border-color,opacity] duration-200 outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 ${VARIANTS[variant]} ${SIZES[size]}`;
}

export type ButtonVariant = keyof typeof VARIANTS;
export type ButtonSize = keyof typeof SIZES;

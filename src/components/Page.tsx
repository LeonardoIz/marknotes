import { ViewTransition } from "react";
import { noteTransitionName } from "@/lib/parse";

/** A page's content: on navigation it fades in from slightly below. Refreshes after a save don't animate it. */
export function Page({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <ViewTransition enter={{ default: "page-in" }} exit={{ default: "page-out" }} default="none">
      <div className={className}>{children}</div>
    </ViewTransition>
  );
}

/** A note's title as one element across pages: it moves from a list row into the note's heading. */
export function NoteName({ title, children, wrap }: { title: string; children: React.ReactNode; wrap?: boolean }) {
  return (
    <ViewTransition name={noteTransitionName(title)} share="morph" default="none">
      {/* In lists a title stays on one line; the note's own heading wraps. */}
      <span className={wrap ? "inline-block" : "inline-block max-w-full truncate align-bottom"}>{children}</span>
    </ViewTransition>
  );
}

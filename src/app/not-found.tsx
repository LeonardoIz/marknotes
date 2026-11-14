import Link from "next/link";
import { buttonClass } from "@/lib/button";

export default function NotFound() {
  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col items-start gap-5 pt-[12vh] animate-in duration-300 fade-in">
      <span className="kicker">404</span>
      <h1 className="font-serif text-[38px] leading-none tracking-[-0.015em]">Nothing here.</h1>
      <p className="font-serif text-lg text-muted-foreground italic">This page doesn’t exist, or it moved.</p>
      <Link href="/" className={buttonClass("outline")}>
        Back to your notes
      </Link>
    </div>
  );
}

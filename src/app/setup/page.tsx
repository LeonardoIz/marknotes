import type { Metadata } from "next";
import { Suspense } from "react";
import { Logo } from "@/components/Logo";
import { SetupForm } from "./SetupForm";

export const metadata: Metadata = { title: "Set up" };

async function Form({ searchParams }: PageProps<"/setup">) {
  const error = (await searchParams).error;
  return <SetupForm error={typeof error === "string" ? error : ""} />;
}

/** First start: the proxy sends every page here until sign-in is chosen. */
export default function SetupPage(props: PageProps<"/setup">) {
  return (
    // Covers the layout's column, like the login page: nothing else works yet.
    <div className="fixed inset-0 z-30 overflow-y-auto bg-background">
      <div className="mx-auto flex w-full max-w-[640px] animate-in flex-col px-6 py-14 duration-500 fade-in sm:py-20">
        <Logo />
        <span className="kicker mt-14">First start</span>
        <h1 className="mt-2 font-serif text-[38px] leading-none tracking-[-0.015em]">Set up your notes</h1>
        <p className="mt-4 mb-10 text-[14px] leading-relaxed text-muted-foreground">
          Choose who can open them and whether agents may connect. All of it can be changed later in Settings.
        </p>
        <Suspense>
          <Form {...props} />
        </Suspense>
      </div>
    </div>
  );
}

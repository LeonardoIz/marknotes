import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { Logo } from "@/components/Logo";
import { getAccess } from "@/lib/access";
import { buttonClass } from "@/lib/button";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Log in" };

async function Login({ searchParams }: PageProps<"/login">) {
  await connection();
  const params = await searchParams;
  // Only a path of this app, never another site (`//evil.com`, `/\evil.com`).
  const target = typeof params.next === "string" && /^\/(?![/\\])/.test(params.next) ? params.next : "/";
  const error = typeof params.error === "string" ? params.error : "";
  const access = getAccess();
  if (!access) redirect("/setup");
  if (access.mode === "none") redirect(target);
  if (access.mode === "password") return <LoginForm next={target} />;
  return (
    <div className="flex flex-col gap-3">
      <a href={`/api/auth/oidc/start?next=${encodeURIComponent(target)}`} className={`${buttonClass()} h-[42px]`}>
        Continue with {access.oidc?.label}
        <ArrowRight aria-hidden strokeWidth={1.75} />
      </a>
      <p role="alert" className="min-h-5 text-[13px] text-destructive">
        {error}
      </p>
    </div>
  );
}

export default function LoginPage(props: PageProps<"/login">) {
  return (
    // Covers the layout's column: the sign-in has its own two-pane frame.
    <div className="fixed inset-0 z-30 grid overflow-y-auto bg-background lg:grid-cols-[minmax(0,1fr)_480px]">
      <div className="hidden flex-col border-r p-14 lg:flex">
        <Logo />
        <div className="mt-auto flex max-w-[560px] animate-in flex-col gap-5 duration-700 fade-in slide-in-from-bottom-2">
          <span className="kicker">Your notes</span>
          <p className="font-serif text-[46px] leading-[1.1] tracking-[-0.015em]">
            Plain Markdown files, <span className="text-muted-foreground italic">kept on your own machine.</span>
          </p>
        </div>
      </div>
      <div className="flex animate-in flex-col justify-center gap-7 p-6 duration-500 fade-in sm:p-14">
        <span className="lg:hidden">
          <Logo />
        </span>
        <h1 className="font-serif text-3xl">Log in</h1>
        <Suspense>
          <Login {...props} />
        </Suspense>
      </div>
    </div>
  );
}

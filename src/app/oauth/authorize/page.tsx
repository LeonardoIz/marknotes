import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Logo } from "@/components/Logo";
import { baseUrl } from "@/lib/config";
import { getSettings } from "@/lib/db";
import { answer, checkAuthorize, OAuthError, resourcePath, type AuthorizeRequest } from "@/lib/oauth";
import { Consent } from "./Consent";

export const metadata: Metadata = { title: "Connect an agent" };

function Problem({ children }: { children: React.ReactNode }) {
  return <p className="text-[14px] leading-relaxed text-muted-foreground">{children}</p>;
}

/** Signed in already (the proxy sends you through the login first, then back here). */
async function Ask({ searchParams }: PageProps<"/oauth/authorize">) {
  const raw = await searchParams;
  const query = new URLSearchParams(Object.entries(raw).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])));
  const settings = getSettings();
  if (!settings.mcpEnabled) return <Problem>Agents are turned off. Turn them on in Settings, then connect again from the agent.</Problem>;

  const base = baseUrl({ headers: await headers() });
  let req: AuthorizeRequest;
  try {
    req = checkAuthorize(query, base + resourcePath);
  } catch (error) {
    if (error instanceof OAuthError && error.redirectUri) {
      redirect(answer(error.redirectUri, query.get("state"), { error: error.code, error_description: error.message }, base));
    }
    return <Problem>{(error as Error).message}</Problem>;
  }
  const back = new URL(req.redirectUri);
  return <Consent query={query.toString()} name={req.client.name} returnTo={back.host || back.protocol} forcedReadOnly={settings.mcpReadOnly} />;
}

export default function AuthorizePage(props: PageProps<"/oauth/authorize">) {
  return (
    <div className="fixed inset-0 z-30 overflow-y-auto bg-background">
      <div className="mx-auto flex w-full max-w-[520px] animate-in flex-col px-6 py-14 duration-500 fade-in sm:py-24">
        <Logo />
        <span className="kicker mt-14">Agents</span>
        <h1 className="mt-2 mb-6 font-serif text-[34px] leading-none tracking-[-0.015em]">Connect an agent</h1>
        <Suspense>
          <Ask {...props} />
        </Suspense>
      </div>
    </div>
  );
}

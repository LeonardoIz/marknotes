import { connection } from "next/server";
import { Suspense } from "react";
import { SettingsForm } from "@/components/SettingsForm";
import { getAccess, summarize } from "@/lib/access";
import { listTemplates } from "@/lib/daily";
import { getSettings, listMcpTokens } from "@/lib/db";
import { listFolders } from "@/lib/notes";
import { listGrants } from "@/lib/oauth";
import { semanticStatus } from "@/lib/semantic";

async function General({ searchParams }: PageProps<"/settings">) {
  await connection();
  const error = (await searchParams).error;
  const [folders, templates] = await Promise.all([listFolders(), listTemplates()]);
  return (
    <SettingsForm
      initial={getSettings()}
      folders={folders}
      templates={templates.map((t) => t.name)}
      semantic={semanticStatus()}
      access={summarize(getAccess()!)}
      accessError={typeof error === "string" ? error : ""}
      mcp={{ tokens: listMcpTokens(), grants: listGrants() }}
    />
  );
}

export default function SettingsPage(props: PageProps<"/settings">) {
  return (
    <Suspense>
      <General {...props} />
    </Suspense>
  );
}

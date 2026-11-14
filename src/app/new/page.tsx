import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { NoteScreen } from "@/components/NoteScreen";
import { Page } from "@/components/Page";
import { listTemplates } from "@/lib/daily";
import { getSettings } from "@/lib/db";
import { listFolders } from "@/lib/notes";

export const metadata: Metadata = { title: "New note" };

async function New({ searchParams }: PageProps<"/new">) {
  await connection();
  const { title, folder } = await searchParams;
  const [folders, templates] = await Promise.all([listFolders(), listTemplates()]);
  return (
    <NoteScreen
      note={null}
      prefs={getSettings()}
      initialTitle={typeof title === "string" ? title : undefined}
      initialFolder={typeof folder === "string" ? folder : ""}
      folders={folders}
      templates={templates.map(({ name, content }) => ({ name, content }))}
    />
  );
}

export default function NewNote(props: PageProps<"/new">) {
  return (
    <Page className="flex flex-1 flex-col">
      <Suspense>
        <New {...props} />
      </Suspense>
    </Page>
  );
}

"use client";

import { FolderPen, FolderPlus, Ellipsis, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { folderHref, noteName, parentFolder } from "@/lib/parse";
import { Menu, menuItem } from "./Menu";
import { Button, toast, usePrompt } from "./ui";

const api = (folder: string) => `/api/folders/${folder.split("/").map(encodeURIComponent).join("/")}`;

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  }).catch(() => null);
  const data = res && res.status !== 204 ? await res.json().catch(() => ({})) : {};
  if (!res?.ok) toast(data.error ?? "Something went wrong.", "error");
  return res?.ok ? data : null;
}

/** New folder here; and for a folder itself, rename/move it or delete it while empty. */
export function FolderActions({ folder, empty }: { folder: string; empty: boolean }) {
  const router = useRouter();
  const [dialog, prompt] = usePrompt();
  const create = async () => {
    const name = await prompt({
      title: "New folder",
      message: folder ? <>Inside {noteName(folder)}. Use / to nest deeper.</> : "Use / to nest folders.",
      label: "Name",
      confirm: "Create",
    });
    if (!name) return;
    const data = await send("/api/folders", "POST", { folder: folder ? `${folder}/${name}` : name });
    if (data) router.push(folderHref(data.folder));
  };

  const rename = async () => {
    const to = await prompt({
      title: "Rename folder",
      message: "Its notes go with it. Change the path to move it into another folder.",
      label: "Path",
      initial: folder,
      confirm: "Rename",
    });
    if (!to || to === folder) return;
    const data = await send(api(folder), "PUT", { folder: to });
    if (data) {
      toast("Folder renamed");
      router.replace(folderHref(data.folder));
    }
  };

  const remove = async () => {
    if (await send(api(folder), "DELETE")) {
      toast("Folder deleted");
      router.replace(folderHref(parentFolder(folder)));
    }
  };

  return (
    <>
      {dialog}
      <Button variant="ghost" onClick={create} title="New folder" aria-label="New folder" className="max-sm:w-[34px] max-sm:px-0">
        <FolderPlus aria-hidden strokeWidth={1.75} />
        <span className="max-sm:hidden">New folder</span>
      </Button>
      {folder && (
        <Menu label="Folder actions" icon={<Ellipsis aria-hidden strokeWidth={1.75} />}>
          <button role="menuitem" type="button" className={menuItem} onClick={rename}>
            <FolderPen aria-hidden /> Rename or move
          </button>
          <button role="menuitem" type="button" className={menuItem} onClick={remove} disabled={!empty} title={empty ? undefined : "Move or delete its notes first"}>
            <Trash2 aria-hidden /> {empty ? "Delete" : "Delete (only when empty)"}
          </button>
        </Menu>
      )}
    </>
  );
}

import { connection } from "next/server";
import { Suspense } from "react";
import { TrashList } from "@/components/TrashList";
import { getSettings } from "@/lib/db";
import { listTrash, purgeTrash } from "@/lib/notes";

async function Trash() {
  await connection();
  const days = getSettings().trashRetentionDays;
  if (days > 0) await purgeTrash({ olderThanDays: days });
  return <TrashList items={await listTrash()} retentionDays={days} />;
}

export default function TrashPage() {
  return (
    <Suspense>
      <Trash />
    </Suspense>
  );
}

import { connection } from "next/server";
import { Suspense } from "react";
import { AttachmentList } from "@/components/AttachmentList";
import { listAttachments } from "@/lib/notes";

async function Attachments() {
  await connection();
  return <AttachmentList items={await listAttachments()} />;
}

export default function AttachmentsPage() {
  return (
    <Suspense>
      <Attachments />
    </Suspense>
  );
}

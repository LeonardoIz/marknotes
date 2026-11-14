import { zipSync } from "fflate";
import { route } from "@/lib/api";
import { exportFiles } from "@/lib/notes";

/** Every note and attachment as one zip, folders kept; app state (.notes) and the trash stay out. */
export const GET = route(async () => {
  // shortcut: builds the zip in memory; fine for notes and modest attachments, stream it (fflate's Zip) past a few hundred MB.
  const zip = zipSync(Object.fromEntries(await exportFiles()), { level: 6 });
  const date = new Date().toISOString().slice(0, 10);
  return new Response(zip, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="notes-${date}.zip"`,
      "Cache-Control": "no-store",
    },
  });
});

import { route } from "@/lib/api";
import { getSettings } from "@/lib/db";
import { listTrash, purgeTrash } from "@/lib/notes";

/** Lists the trash, first dropping what is older than the retention setting (0 keeps everything). */
export const GET = route(async () => {
  const days = getSettings().trashRetentionDays;
  if (days > 0) await purgeTrash({ olderThanDays: days });
  return Response.json(await listTrash());
});

/** Empties the trash. */
export const DELETE = route(async () => Response.json({ deleted: await purgeTrash({ all: true }) }));

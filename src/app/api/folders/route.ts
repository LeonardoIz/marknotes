import { jsonBody, route } from "@/lib/api";
import { createFolder, listFolders } from "@/lib/notes";

export const GET = route(async () => Response.json(await listFolders()));

/** Body: `{ folder }`, a path like `Work/2027`. */
export const POST = route(async (request) => Response.json({ folder: await createFolder((await jsonBody(request)).folder) }, { status: 201 }));

import { route } from "@/lib/api";
import { search } from "@/lib/search";

/** Every note title, for [[link]] completion. */
export const GET = route(async () => Response.json((await search("", "title")).map((h) => h.title)));

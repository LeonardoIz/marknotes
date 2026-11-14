import { route } from "@/lib/api";
import { allTags } from "@/lib/search";

export const GET = route(async () => Response.json(await allTags()));

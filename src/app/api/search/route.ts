import { route } from "@/lib/api";
import { findNotes } from "@/lib/find";
import type { SortKey } from "@/lib/search";

const SORTS: SortKey[] = ["score", "title", "modified"];

/** Words and meaning in one ranked list (meaning joins once it is ready). */
export const GET = route(async (request) => {
  const params = request.nextUrl.searchParams;
  const sort = SORTS.find((s) => s === params.get("sort")) ?? "score";
  const limit = Number(params.get("limit")) || undefined;
  return Response.json((await findNotes(params.get("q") ?? "", sort, limit)).hits);
});

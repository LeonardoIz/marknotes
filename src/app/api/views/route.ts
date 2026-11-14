import { jsonBody, route } from "@/lib/api";
import { createView, listViews } from "@/lib/db";

export const GET = route(async () => Response.json(listViews()));

/** Body: `{ name, query, sort? }`. */
export const POST = route(async (request) => Response.json(createView(await jsonBody(request)), { status: 201 }));

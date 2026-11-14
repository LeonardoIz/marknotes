import { jsonBody, route } from "@/lib/api";
import { createMcpToken, listMcpTokens } from "@/lib/db";

export const GET = route(async () => Response.json(listMcpTokens()));

/** Body: `{ name, readOnly? }`. The response is the only time the token itself is shown. */
export const POST = route(async (request) => Response.json(createMcpToken(await jsonBody(request)), { status: 201 }));

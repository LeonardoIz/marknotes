import { jsonBody, route } from "@/lib/api";
import { getSettings, updateSettings } from "@/lib/db";

export const GET = route(async () => Response.json({ settings: getSettings() }));

export const PUT = route(async (request) => Response.json({ settings: updateSettings(await jsonBody(request)) }));

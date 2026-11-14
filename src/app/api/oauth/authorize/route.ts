import { jsonBody, route } from "@/lib/api";
import { baseUrl } from "@/lib/config";
import { getSettings } from "@/lib/db";
import { answer, checkAuthorize, issueCode, OAuthError, resourcePath } from "@/lib/oauth";

/** You pressed Allow or Deny on /oauth/authorize (signed in, like every other API call): where the browser goes next. */
export const POST = route(async (request) => {
  const settings = getSettings();
  if (!settings.mcpEnabled) return Response.json({ error: "Agents are turned off in Settings." }, { status: 400 });
  const body = await jsonBody(request);
  const base = baseUrl(request);
  const params = new URLSearchParams(typeof body.query === "string" ? body.query : "");
  let req;
  try {
    req = checkAuthorize(params, base + resourcePath);
  } catch (error) {
    if (error instanceof OAuthError && error.redirectUri) {
      return Response.json({ redirect: answer(error.redirectUri, params.get("state"), { error: error.code, error_description: error.message }, base) });
    }
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
  if (body.allow !== true) return Response.json({ redirect: answer(req.redirectUri, req.state, { error: "access_denied" }, base) });
  const code = issueCode(req, body.readOnly === true || settings.mcpReadOnly);
  return Response.json({ redirect: answer(req.redirectUri, req.state, { code }, base) });
});

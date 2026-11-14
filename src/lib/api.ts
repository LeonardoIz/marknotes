import type { NextRequest } from "next/server";
import { isValidSession, SESSION_COOKIE } from "./auth";
import { ZodError } from "zod";
import { NoteError } from "./notes";

/**
 * Wraps a route handler: re-checks the session (the proxy is the first gate, this is the
 * second) and turns NoteError into a JSON error with its status.
 */
export function route<C>(handler: (request: NextRequest, context: C) => Promise<Response>) {
  return async (request: NextRequest, context: C): Promise<Response> => {
    if (!isValidSession(request.cookies.get(SESSION_COOKIE)?.value)) {
      return Response.json({ error: "Not authenticated." }, { status: 401 });
    }
    try {
      return await handler(request, context);
    } catch (error) {
      if (error instanceof NoteError) return Response.json({ error: error.message }, { status: error.status });
      if (error instanceof ZodError) {
        return Response.json({ error: error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") }, { status: 400 });
      }
      console.error(error);
      return Response.json({ error: "Unexpected server error." }, { status: 500 });
    }
  };
}

export async function jsonBody(request: NextRequest): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    if (body && typeof body === "object" && !Array.isArray(body)) return body;
  } catch {}
  throw new NoteError("Expected a JSON object body.", 400);
}

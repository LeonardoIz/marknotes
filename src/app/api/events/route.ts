import { route } from "@/lib/api";
import { subscribe, type Change } from "@/lib/live";

/** Server-Sent Events: one `change` event per note written or removed on disk, whoever did it. */
export const GET = route(async (request) => {
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      const unsubscribe = subscribe((change: Change) => send(`event: change\ndata: ${JSON.stringify(change)}\n\n`));
      // Keeps proxies from closing an idle stream.
      const ping = setInterval(() => send(": ping\n\n"), 25_000);
      cleanup = () => {
        clearInterval(ping);
        unsubscribe();
      };
      request.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {}
      });
      send("retry: 3000\n\n");
    },
    cancel: () => cleanup(),
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      // no-transform: keeps the server's gzip from buffering the stream.
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});

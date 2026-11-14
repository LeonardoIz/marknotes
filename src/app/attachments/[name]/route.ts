import { createReadStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { route } from "@/lib/api";
import { statAttachment } from "@/lib/notes";

// Only these render inline; everything else downloads, so an uploaded .html/.svg can never run as this origin.
const INLINE: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
  ".avif": "image/avif", ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".m4v": "video/mp4",
  ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".oga": "audio/ogg", ".wav": "audio/wav", ".m4a": "audio/mp4",
  ".flac": "audio/flac", ".pdf": "application/pdf",
};

/** Streams an attachment; honors a single `Range: bytes=a-b` so video and audio can seek. */
export const GET = route(async (request, { params }: RouteContext<"/attachments/[name]">) => {
  const { name, file, size } = await statAttachment((await params).name);
  const type = INLINE[path.extname(name).toLowerCase()];
  const headers: Record<string, string> = {
    "Content-Type": type ?? "application/octet-stream",
    "Content-Disposition": `${type ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    "Cache-Control": "private, max-age=3600",
    "Accept-Ranges": "bytes",
  };

  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
  if (range && size > 0) {
    // "a-b", "a-" (to the end) or "-n" (the last n bytes).
    let start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    let end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (!range[1] && !range[2]) [start, end] = [0, size - 1];
    if (start >= size || start > end) {
      return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
    }
    const body = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream;
    return new Response(body, {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }
  const body = Readable.toWeb(createReadStream(file)) as ReadableStream;
  return new Response(body, { headers: { ...headers, "Content-Length": String(size) } });
});

import { route } from "@/lib/api";
import { deleteAttachment } from "@/lib/notes";

export const DELETE = route(async (_, { params }: RouteContext<"/api/attachments/[name]">) => {
  await deleteAttachment((await params).name);
  return new Response(null, { status: 204 });
});

/** On start, a fresh server prints its setup code to the log. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getAccess, announceSetup } = await import("./lib/access");
  if (!getAccess()) announceSetup();
}

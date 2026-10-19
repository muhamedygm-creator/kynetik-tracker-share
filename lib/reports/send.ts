import "server-only";
/** Export responses (Reports fix 2026-10-17): a download with a readable file name, and a plain message on failure. */

export function download(body: BodyInit, name: string, ext: "csv" | "pdf") {
  const ascii = name.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "");
  return new Response(body, {
    headers: {
      "content-type": ext === "pdf" ? "application/pdf" : "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${ascii}.${ext}"; filename*=UTF-8''${encodeURIComponent(`${name}.${ext}`)}`,
      "cache-control": "no-store",
    },
  });
}

/** Runs an export; if it fails, logs the cause (for the Vercel logs) and answers with a short page instead of a bare 500. */
export async function safeExport(what: string, run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (e) {
    console.error(`[export] ${what} failed:`, e instanceof Error ? `${e.message}\n${e.stack}` : e);
    return new Response(`The ${what} could not be made. Try again; if it keeps failing, tell the Owner the time it happened.`, {
      status: 500, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
}

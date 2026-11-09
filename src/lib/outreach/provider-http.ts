import { OutreachError } from "./contracts";

export async function providerJson(url: string, init: RequestInit = {}, fetcher: typeof fetch = fetch): Promise<unknown> {
  let response: Response;
  try { response = await fetcher(url, { ...init, redirect: "error", cache: "no-store", signal: init.signal ?? AbortSignal.timeout(15000) }); }
  catch { throw new OutreachError("provider_unavailable"); }
  if (!response.ok) { await response.body?.cancel(); throw new OutreachError([400,401,403].includes(response.status) ? "reconnect" : "provider_unavailable"); }
  const reader = response.body?.getReader(); if (!reader) throw new OutreachError("provider_invalid");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 1048576) { await reader.cancel(); throw new OutreachError("provider_invalid"); } chunks.push(part.value); }
    const data: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return data;
  } catch { throw new OutreachError("provider_invalid"); }
}

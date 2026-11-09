"use server";
import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/auth/session";
import { providerAppService } from "@/lib/outreach/provider-apps";
import { outreachErrorMessage } from "@/lib/outreach/contracts";
import { InstagramConnectionError } from "@/lib/outreach/instagram-errors";
export async function checkInstagramApp(input: unknown) {
  const actor = await requireActor();
  try { return { check: await providerAppService().checkInstagram(actor, input) }; }
  catch (error) {
    if (error instanceof InstagramConnectionError) console.warn(JSON.stringify({ event: "outreach.instagram_app_check_failed", code: error.code, diagnostic: error.diagnostic }));
    return { error: outreachErrorMessage(error) };
  }
}
export async function saveProviderApp(input: unknown) {
  const actor = await requireActor();
  try {
    await providerAppService().save(actor, input);
    revalidatePath("/settings/accounts"); revalidatePath("/settings/connections");
    return { statuses: await providerAppService().status(actor) };
  } catch (error) { return { error: outreachErrorMessage(error) }; }
}

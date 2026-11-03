"use server";
import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/auth/session";
import { providerAppService } from "@/lib/outreach/provider-apps";
import { outreachErrorMessage } from "@/lib/outreach/contracts";
export async function saveProviderApp(input: unknown) {
  const actor = await requireActor();
  try {
    await providerAppService().save(actor, input);
    revalidatePath("/settings/accounts"); revalidatePath("/settings/connections");
    return { statuses: await providerAppService().status(actor) };
  } catch (error) { return { error: outreachErrorMessage(error) }; }
}

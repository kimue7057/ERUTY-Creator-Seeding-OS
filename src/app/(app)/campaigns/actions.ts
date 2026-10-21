"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/auth/session";
import { saveCampaign } from "@/lib/campaigns/service";
import { campaignSchema } from "@/lib/validation/campaigns";
import { actionError, type ActionState } from "@/lib/action-state";
export async function campaignAction(id: string | undefined, _: ActionState, form: FormData): Promise<ActionState> {
  const actor = await requireActor();
  let savedId: string;
  const number = (key: string) => { const raw = form.get(key); return typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN; };
  try {
    const data = campaignSchema.parse({
      projectId: form.get("projectId"), title: form.get("title"), productIds: form.getAll("productIds"),
      countryCodes: form.getAll("countryCodes"), platforms: form.getAll("platforms"),
      categories: String(form.get("categories") ?? "").split(",").map(s => s.trim()).filter(Boolean),
      followerMin: number("followerMin"), followerMax: number("followerMax"), goalCount: number("goalCount"),
      notes: form.get("notes"), exclusions: form.get("exclusions"),
      budget: !form.get("budget") ? null : number("budget"), currency: form.get("currency"),
      startsOn: form.get("startsOn") || null, endsOn: form.get("endsOn") || null, status: form.get("status"),
    });
    savedId = (await saveCampaign(actor, data, id)).id;
  } catch (error) { return actionError(error); }
  revalidatePath("/", "layout");
  redirect(`/campaigns/${savedId}`);
}

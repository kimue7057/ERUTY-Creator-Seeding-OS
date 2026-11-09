import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { currentActor, SESSION_COOKIE, tokenHash } from "@/lib/auth/session";
import { accountService } from "@/lib/outreach/accounts";
import { providerSchema, OutreachError } from "@/lib/outreach/contracts";
import { InstagramConnectionError } from "@/lib/outreach/instagram-errors";
export const maxDuration = 60;
export async function GET(request:Request,{params}:{params:Promise<{provider:string}>}) {
  const origin=process.env.APP_ORIGIN; if(!origin) return new Response("Service unavailable",{status:503});
  const destination=new URL("/settings/accounts",origin),query=new URL(request.url).searchParams;
  try {
    const actor=await currentActor(),session=(await cookies()).get(SESSION_COOKIE)?.value;
    if(!actor||!session) throw new OutreachError("oauth_expired");
    await accountService().complete(actor,providerSchema.parse((await params).provider),query.get("state")??"",tokenHash(session),query.has("error")?null:query.get("code"));
    destination.searchParams.set("connection","success");
  } catch(error) {
    const code=error instanceof OutreachError?error.code:"provider_invalid";
    // Never log request URLs, OAuth parameters, error bodies or credentials.
    console.warn(JSON.stringify({event:"outreach.oauth_failed",provider:providerSchema.safeParse((await params).provider).data??"unknown",code,...(error instanceof InstagramConnectionError?{diagnostic:error.diagnostic}:{})}));
    destination.searchParams.set("connection",code);
  }
  const response=NextResponse.redirect(destination,303);
  response.headers.set("Cache-Control","no-store");response.headers.set("Referrer-Policy","no-referrer");
  return response;
}

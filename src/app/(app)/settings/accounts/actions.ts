"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireActor, SESSION_COOKIE, tokenHash } from "@/lib/auth/session";
import { accountService } from "@/lib/outreach/accounts";
import { outreachErrorMessage } from "@/lib/outreach/contracts";
import { InstagramConnectionError } from "@/lib/outreach/instagram-errors";
export type AccountActionState = { error?: string; message?: string };
export async function accountAction(_previous:AccountActionState,form:FormData):Promise<AccountActionState> {
  const actor=await requireActor(),service=accountService(); let url:string|undefined;
  try {
    const action=String(form.get("action")),id=String(form.get("id"));
    if(action==="register") await service.register(actor,{provider:form.get("provider"),label:form.get("label"),identity:form.get("identity")});
    else if(action==="connect") {
      const session=(await cookies()).get(SESSION_COOKIE)?.value;
      if(!session) redirect("/login");
      url=await service.begin(actor,id,tokenHash(session),form.get("aliases")==="on");
    } else if(action==="instagram-system-user") {
      await service.connectInstagramSystemUser(actor,id,{accessToken:form.get("accessToken"),revision:Number(form.get("revision")),updatedAt:form.get("updatedAt"),confirmed:form.get("confirmed")==="on"});
    } else if(action==="sync") await service.sync(actor,id);
    else if(action==="disconnect") await service.disconnect(actor,id);
    else return {error:"작업을 선택하세요."};
    revalidatePath("/settings/accounts");
  } catch(error) {
    if(error instanceof InstagramConnectionError)console.warn(JSON.stringify({event:"outreach.instagram_token_connection_failed",code:error.code,diagnostic:error.diagnostic}));
    return {error:outreachErrorMessage(error)};
  }
  if(url) redirect(url);
  return {message:form.get("action")==="instagram-system-user"?"Meta 앱과 Instagram 계정을 검증하고 연결했습니다.":form.get("action")==="register"?"계정을 등록했습니다. 로그인 연결을 진행하세요.":form.get("action")==="disconnect"?"ERUTY의 계정 연결을 해제했습니다.":"계정 정보를 업데이트했습니다."};
}

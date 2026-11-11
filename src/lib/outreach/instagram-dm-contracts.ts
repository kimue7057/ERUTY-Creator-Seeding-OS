import { z } from "zod";
import { OutreachError } from "./contracts";
export const instagramConversationId=z.string().regex(/^[A-Za-z0-9_:.=+/-]{1,1024}$/);
export const instagramScopedId=z.string().regex(/^\d{1,64}$/);
export const dmSelectionSchema=z.object({conversationId:instagramConversationId,recipientId:instagramScopedId,username:z.string().regex(/^[\w.]{1,30}$/)}).strict();
export const instagramReplySchema=z.object({id:z.uuid(),accountId:z.uuid(),selection:dmSelectionSchema,body:z.string().trim().min(1).max(1000),confirmed:z.literal(true),expectedLastMessageId:z.string().min(1).max(1024).nullable().optional(),draftId:z.uuid().nullable().default(null),draftRevision:z.number().int().positive().nullable().default(null)}).strict();
export type DmSelection=z.infer<typeof dmSelectionSchema>;
export type DmMessage={id:string;createdAt:string;senderId:string;senderUsername:string|null;text:string;incoming:boolean};
export type DmConversation={id:string;updatedAt:string;recipientId:string|null;username:string|null;preview:string};
export type DmThread={selection:DmSelection;messages:DmMessage[];lastIncomingAt:string|null;replyUntil:string|null;canReply:boolean};
export const DM_WINDOW_MS=24*60*60*1000;
export function assertDmWindow(lastIncomingAt:string|null,now=Date.now()){
  const time=lastIncomingAt?Date.parse(lastIncomingAt):NaN;
  if(!Number.isFinite(time)||time>now+30000)throw new OutreachError("instagram_dm_inbound_required");
  if(now-time>=DM_WINDOW_MS)throw new OutreachError("instagram_dm_window_closed");
}

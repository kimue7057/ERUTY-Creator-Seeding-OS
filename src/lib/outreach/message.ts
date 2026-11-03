import { z } from "zod";
export const draftInputSchema=z.object({id:z.uuid(),campaignId:z.uuid(),creatorAccountId:z.uuid(),inputSha256:z.string().regex(/^[a-f0-9]{64}$/),revision:z.number().int().min(0),channel:z.enum(["email","instagram","tiktok"]),subject:z.string().max(200).refine(v=>!/[\r\n]/.test(v)),body:z.string().max(12000),template:z.enum(["letter","brand"]),senderAccountId:z.uuid().nullable(),fromAddress:z.string().max(254),toAddress:z.string().max(254),recipientSource:z.string().max(2048)});
export type DraftInput=z.infer<typeof draftInputSchema>;
export const escapeHtml=(v:string)=>v.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
export function messageHtml(subject:string,body:string,template:"letter"|"brand",from:string) {
  const text=`<div style="font-size:15px;line-height:1.8;white-space:pre-wrap">${escapeHtml(body)}</div><hr style="margin:28px 0;border:0;border-top:1px solid #ddd"><p style="font-size:12px;color:#666">${escapeHtml(from)}</p>`;
  return `<html><body style="margin:0;background:#f4f5f1;font-family:Arial,sans-serif;color:#20372b"><div style="max-width:600px;margin:24px auto;background:#fff;padding:32px">${template==="brand"?`<div style="border-top:4px solid #2b553d;padding-top:24px"><h1 style="font-size:22px;line-height:1.5">${escapeHtml(subject)}</h1></div>`:""}${text}</div></body></html>`;
}
const encoded=(value:string)=>`=?UTF-8?B?${Buffer.from(value).toString("base64")}?=`;
const folded=(value:string)=>Buffer.from(value).toString("base64").match(/.{1,76}/g)?.join("\r\n")??"";
export function rawEmail(input:{id:string;from:string;to:string;subject:string;body:string;template:"letter"|"brand"}) {
  const from=z.email().parse(input.from),to=z.email().parse(input.to),subject=z.string().min(1).max(200).refine(v=>!/[\r\n]/.test(v)).parse(input.subject);
  z.uuid().parse(input.id);const boundary=`eruty_${input.id.replaceAll("-","")}`;
  const raw=[`From: ${from}`,`To: ${to}`,`Subject: ${encoded(subject)}`,`Message-ID: <${input.id}@${from.split("@")[1]}>`,`Date: ${new Date().toUTCString()}`,"MIME-Version: 1.0",`Content-Type: multipart/alternative; boundary="${boundary}"`,"",`--${boundary}`,"Content-Type: text/plain; charset=UTF-8","Content-Transfer-Encoding: base64","",folded(`${input.body}\n\n${from}`),`--${boundary}`,"Content-Type: text/html; charset=UTF-8","Content-Transfer-Encoding: base64","",folded(messageHtml(subject,input.body,input.template,from)),`--${boundary}--`,""].join("\r\n");
  return Buffer.from(raw).toString("base64url");
}

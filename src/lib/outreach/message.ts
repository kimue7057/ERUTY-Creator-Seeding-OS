import { z } from "zod";
import { dmSelectionSchema } from "./instagram-dm-contracts";
import { brandingSchema, defaultBranding, layoutSchema, type MailLayout, type MailBranding } from "./template-contracts";
export const draftInputSchema=z.object({id:z.uuid(),campaignId:z.uuid(),creatorAccountId:z.uuid(),inputSha256:z.string().regex(/^[a-f0-9]{64}$/),revision:z.number().int().min(0),channel:z.enum(["email","instagram","tiktok"]),subject:z.string().max(200).refine(v=>!/[\r\n]/.test(v)),body:z.string().max(12000),template:layoutSchema,branding:brandingSchema.default(defaultBranding),language:z.enum(["한국어","English"]).default("English"),purpose:z.string().max(1500).default(""),senderAccountId:z.uuid().nullable(),fromAddress:z.string().max(254),toAddress:z.string().max(254),recipientSource:z.string().max(2048),instagramConversation:dmSelectionSchema.nullable().default(null)});
export type DraftInput=z.infer<typeof draftInputSchema>;
export const escapeHtml=(v:string)=>v.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
export function signatureText(from: string, branding: MailBranding) {
  return [branding.signature || branding.companyName, from, branding.website].filter(Boolean).join("\n");
}
export function messageHtml(subject:string,body:string,template:MailLayout,from:string,branding:MailBranding=defaultBranding) {
  const brand=brandingSchema.parse(branding), color=brand.color;
  const signature=`<div style="margin-top:28px;padding-top:18px;border-top:1px solid #e2e5e0;font-size:12px;line-height:1.8;color:#626862;white-space:pre-wrap;overflow-wrap:anywhere">${escapeHtml(signatureText(from,brand))}</div>`;
  const heading=template==="brand"?`<div style="background:${color};color:#fff;padding:28px"><div style="font-size:12px;letter-spacing:2px">${escapeHtml(brand.companyName)}</div><h1 style="font-size:24px;line-height:1.5;margin:12px 0 0">${escapeHtml(subject)}</h1></div>`:template==="proposal"?`<div style="border-top:4px solid ${color};border-bottom:1px solid #e2e5e0;padding:24px 28px"><div style="font-size:12px;color:${color}">${escapeHtml(brand.companyName)}</div><h1 style="font-size:22px;line-height:1.5;margin:10px 0 0">${escapeHtml(subject)}</h1></div>`:"";
  const padding=template==="followup"?"20px":"28px";
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"></head><body style="margin:0;background:#f4f5f1;font-family:Arial,sans-serif;color:#20372b"><div style="max-width:600px;margin:20px auto;background:#fff;overflow-wrap:anywhere">${heading}<div style="padding:${padding}"><div style="font-size:15px;line-height:1.8;white-space:pre-wrap">${escapeHtml(body)}</div>${signature}</div></div></body></html>`;
}
const encoded=(value:string)=>`=?UTF-8?B?${Buffer.from(value).toString("base64")}?=`;
const folded=(value:string)=>Buffer.from(value).toString("base64").match(/.{1,76}/g)?.join("\r\n")??"";
export function rawEmail(input:{id:string;from:string;to:string;subject:string;body:string;template:MailLayout;branding?:MailBranding}) {
  const from=z.email().parse(input.from),to=z.email().parse(input.to),subject=z.string().min(1).max(200).refine(v=>!/[\r\n]/.test(v)).parse(input.subject);
  z.uuid().parse(input.id);const boundary=`eruty_${input.id.replaceAll("-","")}`;
  const branding=brandingSchema.parse(input.branding??defaultBranding);
  const raw=[`From: ${from}`,`To: ${to}`,`Subject: ${encoded(subject)}`,`Message-ID: <${input.id}@${from.split("@")[1]}>`,`Date: ${new Date().toUTCString()}`,"MIME-Version: 1.0",`Content-Type: multipart/alternative; boundary="${boundary}"`,"",`--${boundary}`,"Content-Type: text/plain; charset=UTF-8","Content-Transfer-Encoding: base64","",folded(`${input.body}\n\n${signatureText(from,branding)}`),`--${boundary}`,"Content-Type: text/html; charset=UTF-8","Content-Transfer-Encoding: base64","",folded(messageHtml(subject,input.body,input.template,from,branding)),`--${boundary}--`,""].join("\r\n");
  return Buffer.from(raw).toString("base64url");
}

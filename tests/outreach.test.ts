import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { seal,unseal } from "../src/lib/outreach/crypto";
import { registerAccountSchema } from "../src/lib/outreach/contracts";
import { googleAddresses,GOOGLE_SEND_SCOPE,matchesExpected,providerConfig } from "../src/lib/outreach/providers";
import { messageHtml,rawEmail } from "../src/lib/outreach/message";
import { applyTemplate, defaultBranding, layouts, hasPlaceholders } from "../src/lib/outreach/template-contracts";
import { parseGoogleClientFile } from "../src/lib/outreach/app-contracts";

test("four fixed designs preserve message text, escape signatures and include identical plain/HTML sender details",()=>{
  const body="Preserved message\nSecond line",branding={...defaultBranding,companyName:"Company",signature:"<script>unsafe</script>\nCompany team",website:"https://example.invalid"};
  const htmls=Object.keys(layouts).map(layout=>messageHtml("Title",body,layout as keyof typeof layouts,"alias@example.invalid",branding));
  assert.equal(new Set(htmls).size,4);
  for(const html of htmls){assert.ok(html.includes(body));assert.ok(html.includes("&lt;script&gt;unsafe"));assert.ok(!html.includes("<script>unsafe"));}
  const raw=Buffer.from(rawEmail({id:randomUUID(),from:"alias@example.invalid",to:"creator@example.invalid",subject:"Title",body,template:"proposal",branding}),"base64url").toString();
  const parts=raw.split("Content-Transfer-Encoding: base64\r\n\r\n").slice(1).map(p=>Buffer.from(p.split("\r\n--")[0],"base64").toString());
  assert.ok(parts[0].includes(branding.signature));assert.ok(parts[1].includes("&lt;script&gt;unsafe"));
  assert.throws(()=>messageHtml("x","x","brand","x",{...branding,color:"red;url(javascript:evil)"}));
  assert.throws(()=>messageHtml("x","x","brand","x",{...branding,website:"javascript:evil"}));
});
test("template variables are literal data and unresolved variables stay visible; only matching web OAuth files import",()=>{
  assert.equal(applyTemplate("Hi {{creator}}, {{reason}}",{creator:"A $&",brand:"B",campaign:"C",reason:"Verified reason"}),"Hi A $&, Verified reason");
  assert.equal(hasPlaceholders("{{unknown}}"),true);assert.equal(hasPlaceholders("Actual message"),false);
  const uri="https://example.invalid/api/outreach/oauth/google/callback",web={client_id:"synthetic.apps.googleusercontent.com",client_secret:"synthetic",redirect_uris:[uri]};
  assert.deepEqual(parseGoogleClientFile(JSON.stringify({web}),uri),{clientId:web.client_id,clientSecret:web.client_secret});
  assert.throws(()=>parseGoogleClientFile(JSON.stringify({installed:web}),uri));
  assert.throws(()=>parseGoogleClientFile(JSON.stringify({web}),"https://other.invalid/callback"));
});
test("sender tokens are authenticated and bound to the organization and account",()=>{
  const key="a".repeat(64),context="org-a:account-a",value=seal("synthetic-refresh-token",context,key);
  assert.equal(unseal(value,context,key),"synthetic-refresh-token");
  assert.throws(()=>unseal(value,"org-b:account-a",key));assert.throws(()=>unseal(value,context,"b".repeat(64)));
  assert.throws(()=>seal("token",context,"invalid"));assert.ok(!value.includes("synthetic"));
});
test("registration validates contact identity and connection availability never depends on a handle alone",()=>{
  assert.ok(registerAccountSchema.safeParse({provider:"google",label:"Company",identity:"sender@example.invalid"}).success);
  assert.ok(!registerAccountSchema.safeParse({provider:"instagram",label:"Company",identity:"https://instagram.com/anything"}).success);
  assert.equal(providerConfig("google",{APP_ORIGIN:"https://example.invalid"}).configured,false);
  assert.equal(providerConfig("google",{APP_ORIGIN:"https://example.invalid",OUTREACH_GOOGLE_CLIENT_ID:"synthetic",OUTREACH_GOOGLE_CLIENT_SECRET:"synthetic",OUTREACH_ENCRYPTION_KEY:"a".repeat(64)}).configured,true);
});
test("only Gmail-accepted aliases are eligible, and identity matching uses verified provider output",async()=>{
  const mock:typeof fetch=async()=>Response.json({sendAs:[{sendAsEmail:"main@example.invalid",isPrimary:true},{sendAsEmail:"approved@example.invalid",verificationStatus:"accepted"},{sendAsEmail:"pending@example.invalid",verificationStatus:"pending"}]});
  const addresses=await googleAddresses("synthetic","main@example.invalid",true,mock);
  assert.deepEqual(addresses.map(a=>a.address),["main@example.invalid","approved@example.invalid"]);
  const result={id:"synthetic",identity:"main@example.invalid",addresses,tokens:{accessToken:"synthetic",expiresAt:Date.now()+100000,scopes:[GOOGLE_SEND_SCOPE]}};
  assert.ok(matchesExpected("approved@example.invalid",result));assert.ok(!matchesExpected("unrelated@example.invalid",result));
});
test("email rendering escapes creator text and MIME sends the exact selected endpoints",()=>{
  const html=messageHtml("<script>title</script>","<img src=x onerror=alert(1)>\nHello","brand","sender@example.invalid");
  assert.ok(!html.includes("<script>"));assert.ok(html.includes("&lt;img"));
  const raw=Buffer.from(rawEmail({id:randomUUID(),from:"alias@example.invalid",to:"creator@example.invalid",subject:"공식 제안",body:"안녕하세요\n본문",template:"letter"}),"base64url").toString();
  assert.match(raw,/From: alias@example.invalid\r\nTo: creator@example.invalid/);assert.match(raw,/multipart\/alternative/);
  assert.throws(()=>rawEmail({id:randomUUID(),from:"sender@example.invalid\r\nBcc: other@example.invalid",to:"creator@example.invalid",subject:"x",body:"x",template:"letter"}));
});

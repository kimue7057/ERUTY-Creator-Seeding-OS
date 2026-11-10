// Portable browser-contact adapter: no database access or Instagram credentials.
import {existsSync,readFileSync,realpathSync,statSync,writeFileSync} from "node:fs";
import {resolve,relative,isAbsolute,sep,dirname} from "node:path";
import {z} from "zod";
import {browserSendGrant,browserObservation,browserFinish} from "../src/lib/outreach/browser-contracts";
const root=realpathSync(resolve(".local/discovery/codex-browser"));
function privateFile(value:string){const path=realpathSync(resolve(value)),rel=relative(root,path);if(!rel||rel.startsWith(".."+sep)||rel===".."||isAbsolute(rel)||!statSync(path).isFile()||statSync(path).size>65536)throw Error("private_input_required");return path;}
const read=(path:string)=>JSON.parse(readFileSync(privateFile(path),"utf8").replace(/^\uFEFF/,""));
try{
  const [action,file,payloadFile]=process.argv.slice(2),grantPath=privateFile(file),grant=browserSendGrant.parse(read(file));
  if(!["context","arm","finish"].includes(action))throw Error("invalid_action");
  const connection=z.strictObject({origin:z.url(),token:z.string().regex(/^[a-f0-9]{64}$/),expires_at:z.iso.datetime()}).parse(read(resolve(root,"remote-connection.private.json"))),url=new URL(connection.origin);
  if(url.protocol!=="https:"||url.username||url.password||url.pathname!=="/"||url.search||url.hash||Date.parse(connection.expires_at)<=Date.now())throw Error("invalid_connection");
  let input:unknown=grant;
  if(action==="arm")input={...grant,observation:browserObservation.parse(read(payloadFile))};
  if(action==="finish")input=browserFinish.parse({...grant,...z.object({outcome:browserFinish.shape.outcome,reason:browserFinish.shape.reason,observation:browserFinish.shape.observation}).strict().parse(read(payloadFile))});
  const receipt=resolve(dirname(grantPath),`${action}-receipt.private.json`);
  if(action==="arm"&&existsSync(receipt))throw Error("send_permit_already_requested");
  // A durable local marker prevents a second arm call after a lost response.
  if(action==="arm")writeFileSync(receipt,JSON.stringify({requested_at:new Date().toISOString(),acknowledged:false}),{flag:"wx",mode:0o600});
  const response=await fetch(`${url.origin}/api/outreach/browser/${action}`,{method:"POST",redirect:"error",signal:AbortSignal.timeout(30000),headers:{"content-type":"application/json","x-eruty-outreach":"1",authorization:`Bearer ${connection.token}`},body:JSON.stringify(input)});
  const result=await response.json();if(!response.ok)throw Error(`outreach_api_${response.status}:${String(result.error??"failed")}`);
  if(action!=="context")writeFileSync(receipt,JSON.stringify({saved_at:new Date().toISOString(),acknowledged:true,result},null,2),{mode:0o600});
  console.log(JSON.stringify(result));
}catch(error){console.error(JSON.stringify({failed:true,error:error instanceof Error&&/^outreach_api_\d+:\w+$/.test(error.message)?error.message:"outreach_input_or_connection_failed",send_permitted:false}));process.exitCode=1;}

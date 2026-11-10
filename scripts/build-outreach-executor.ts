import {readFileSync,mkdirSync,writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {outreachExtensionId} from "../src/lib/outreach/executor-contracts";
const root="extensions/instagram-executor",files=["manifest.json","background.js","instagram.js","popup.html","popup.js"];
const manifest=JSON.parse(readFileSync(`${root}/manifest.json`,"utf8"));
const id=[...createHash("sha256").update(Buffer.from(manifest.key,"base64")).digest().subarray(0,16)].map(b=>String.fromCharCode(97+(b>>4),97+(b&15))).join("");
if(id!==outreachExtensionId)throw new Error("Extension public key/website ID mismatch");
function crc32(bytes:Buffer){let value=0xffffffff;for(const byte of bytes){value^=byte;for(let n=0;n<8;n++)value=(value>>>1)^(value&1?0xedb88320:0);}return(value^0xffffffff)>>>0;}
const entries:Buffer[]=[],directory:Buffer[]=[];let offset=0;
for(const file of files){const name=Buffer.from(file),bytes=readFileSync(`${root}/${file}`),crc=crc32(bytes),local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt32LE(crc,14);local.writeUInt32LE(bytes.length,18);local.writeUInt32LE(bytes.length,22);local.writeUInt16LE(name.length,26);entries.push(local,name,bytes);
  const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt32LE(crc,16);central.writeUInt32LE(bytes.length,20);central.writeUInt32LE(bytes.length,24);central.writeUInt16LE(name.length,28);central.writeUInt32LE(offset,42);directory.push(central,name);offset+=local.length+name.length+bytes.length;
}
const central=Buffer.concat(directory),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(central.length,12);end.writeUInt32LE(offset,16);mkdirSync("public/downloads",{recursive:true});writeFileSync("public/downloads/eruty-instagram-executor.zip",Buffer.concat([...entries,central,end]));console.log(`Built outreach executor ${manifest.version}; public extension ID verified.`);

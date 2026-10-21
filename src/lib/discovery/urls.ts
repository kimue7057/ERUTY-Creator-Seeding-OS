import { DiscoveryError } from "./contracts";
import type { DiscoveryPlatform } from "../db/discovery-schema";
const fail = (): never => { throw new DiscoveryError(400, "invalid_source_url"); };
const origin = { instagram: "https://www.instagram.com", tiktok: "https://www.tiktok.com", youtube: "https://www.youtube.com" };
function parsed(platform: DiscoveryPlatform, value: string, short = false) {
  let url: URL;
  try { url = new URL(value); } catch { return fail(); }
  const allowed = [`${platform}.com`, `www.${platform}.com`, `m.${platform}.com`, ...(platform === "youtube" && short ? ["youtu.be"] : [])];
  if (url.protocol !== "https:" || url.username || url.password || url.port || !allowed.includes(url.hostname) || value.length > 2048) return fail();
  return url;
}
function handle(value: string, platform: DiscoveryPlatform) {
  let decoded: string;
  try { decoded = decodeURIComponent(value).normalize("NFC"); } catch { return fail(); }
  const valid = platform === "youtube" ? /^[\p{L}\p{M}\p{N}_\-.·]{1,100}$/u.test(decoded) : /^[a-zA-Z0-9._]{1,30}$/.test(decoded);
  if (!valid || ["accounts", "explore", "p", "reel", "reels", "stories", "direct", "about", "legal", "developer", "search"].includes(decoded.toLowerCase())) return fail();
  return decoded;
}
export function profileIdentity(platform: DiscoveryPlatform, value: string) {
  const url = parsed(platform, value);
  if (platform === "youtube") {
    const channel = /^\/channel\/(UC[A-Za-z0-9_-]{22})\/?$/.exec(url.pathname);
    if (channel) return { url: `${origin.youtube}/channel/${channel[1]}`, handle: null, stableId: channel[1] };
  }
  const match = (platform === "instagram" ? /^\/([^/]+)\/?$/ : /^\/@([^/]+)\/?$/).exec(url.pathname);
  if (!match) return fail();
  const currentHandle = handle(match[1], platform);
  const normalized = encodeURIComponent(currentHandle.toLowerCase());
  return { url: `${origin[platform]}/${platform === "instagram" ? "" : "@"}${normalized}${platform === "instagram" ? "/" : ""}`, handle: currentHandle, stableId: null };
}
export function contentUrl(platform: DiscoveryPlatform, value: string) {
  const url = parsed(platform, value, true);
  if (platform === "instagram") {
    const m = /^\/(p|reel|tv)\/([A-Za-z0-9_-]{3,100})\/?$/.exec(url.pathname);
    return m ? `${origin.instagram}/${m[1]}/${m[2]}/` : fail();
  }
  if (platform === "tiktok") {
    const m = /^\/@([^/]+)\/(video|photo)\/([0-9]{5,30})\/?$/.exec(url.pathname);
    return m ? `${origin.tiktok}/@${encodeURIComponent(handle(m[1], platform).toLowerCase())}/${m[2]}/${m[3]}` : fail();
  }
  const id = url.hostname === "youtu.be" ? url.pathname.slice(1) : url.pathname === "/watch" ? url.searchParams.get("v") : /^\/(?:shorts|live)\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname)?.[1];
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? `${origin.youtube}/watch?v=${id}` : fail();
}
export function searchSourceUrl(platform: DiscoveryPlatform, value: string, supplemental = false) {
  const raw = new URL(value);
  if (supplemental && raw.protocol === "https:" && raw.hostname === "www.google.com" && raw.pathname === "/search" && !raw.username && !raw.password && !raw.port) return `https://www.google.com/search?q=${encodeURIComponent(raw.searchParams.get("q")?.slice(0, 500) ?? "")}`;
  const url = parsed(platform, value);
  const path = decodeURIComponent(url.pathname);
  if (/[\u0000-\u0020\\]/.test(path) || /(?:login|oauth|authorize|callback|account)/i.test(path)) return fail();
  const query = platform === "youtube" && url.pathname === "/results" ? `?search_query=${encodeURIComponent(url.searchParams.get("search_query")?.slice(0, 500) ?? "")}` : "";
  return `${origin[platform]}${url.pathname}${query}`;
}

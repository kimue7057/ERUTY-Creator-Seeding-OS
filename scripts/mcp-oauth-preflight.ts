import "dotenv/config";
import { readFileSync } from "node:fs";
import { probeOAuthConfig } from "../src/lib/probe/config";
import { inspectProbeOAuth } from "../src/lib/probe/oauth-preflight";
try {
  const tokenFile = process.env.MCP_PREFLIGHT_TOKEN_FILE;
  const token = tokenFile ? readFileSync(tokenFile, "utf8").trim() : undefined;
  if (tokenFile && (!token || token.length > 8192)) throw new Error("Empty/oversized token file");
  const result = await inspectProbeOAuth(probeOAuthConfig(), process.env.MCP_OAUTH_METADATA_URL!, token);
  console.log(JSON.stringify(result));
} catch { console.error("OAuth preflight failed. Check metadata, S256, public client, scopes and JWT contract locally. No tokens or provider response bodies are printed."); process.exitCode = 1; }

import { build } from "esbuild";
await build({ entryPoints: ["scripts/mcp-server.ts"], outfile: ".local/build/mcp-server.mjs", bundle: true, platform: "node", format: "esm", target: "node22", packages: "external" });
console.log("MCP Node bundle prepared in .local/build. No deployment performed.");

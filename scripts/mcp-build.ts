import { build } from "esbuild";
await build({ entryPoints: ["mcp-server", "mcp-oauth-preflight", "mcp-staging-init", "mcp-staging-verify", "mcp-provision", "mcp-revoke", "migrate"].map(name => `scripts/${name}.ts`), outdir: ".local/build", outExtension: { ".js": ".mjs" }, bundle: true, platform: "node", format: "esm", target: "node22", packages: "external" });
console.log("MCP Node bundle prepared in .local/build. No deployment performed.");

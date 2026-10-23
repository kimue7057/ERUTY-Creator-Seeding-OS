export function persistentOAuthRouting<T extends Record<string, unknown>>(profile: T, tunnelId: string, target: string, issuer: string) {
  const oauth = new URL(issuer);
  if (oauth.protocol !== "https:" || oauth.username || oauth.password || oauth.search || oauth.hash) throw new Error("Invalid configured OAuth issuer");
  const control = profile.control_plane as { tunnel_id?: string } | undefined;
  const mcp = profile.mcp as { server_urls?: { url: string; channel: string }[] } | undefined;
  if (control?.tunnel_id !== tunnelId || mcp?.server_urls?.length !== 1 || mcp.server_urls[0].url !== target || mcp.server_urls[0].channel !== "main") throw new Error("Preserve the existing tunnel identity and target; profile mismatch");
  const harpoon = profile.harpoon as { targets?: { label: string; url: string }[] } | undefined;
  const targets = (harpoon?.targets ?? []).filter(t => !["eruty-oauth", "eruty-discovery-oauth"].includes(t.label));
  return { ...profile, mcp: { ...mcp, oauth_trusted_origins: [oauth.origin] }, harpoon: { ...harpoon, allow_plaintext_http: true, capture_payloads: false, targets: [...targets, { label: "eruty-oauth", url: oauth.origin, description: "Configured ERUTY OAuth issuer" }] } };
}

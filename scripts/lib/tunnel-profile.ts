export function persistentOAuthRouting<T extends Record<string, unknown>>(profile: T, tunnelId: string, target: string, issuer: string) {
  const oauth = new URL(issuer);
  if (oauth.protocol !== "https:" || oauth.username || oauth.password || oauth.search || oauth.hash) throw new Error("Invalid configured OAuth issuer");
  const control = profile.control_plane as { tunnel_id?: string } | undefined;
  const mcp = profile.mcp as { server_urls?: { url: string; channel: string }[] } | undefined;
  if (control?.tunnel_id !== tunnelId || mcp?.server_urls?.length !== 1 || mcp.server_urls[0].url !== target || mcp.server_urls[0].channel !== "main") throw new Error("Preserve the existing tunnel identity and target; profile mismatch");
  const harpoon = profile.harpoon as { targets?: { label: string; url: string; description?: string }[] } | undefined;
  const targets = (harpoon?.targets ?? []).filter(t => !["eruty-oauth", "eruty-discovery-oauth"].includes(t.label));
  return { ...profile, mcp: { ...mcp, oauth_trusted_origins: [oauth.origin] }, harpoon: { ...harpoon, allow_plaintext_http: true, capture_payloads: false, targets: [...targets, { label: "eruty-oauth", url: oauth.origin, description: "Configured ERUTY OAuth issuer" }] } };
}

// Vendor 0.0.16 regenerates its profile in `runtimes connect`. Its managed child
// inherits these overrides, so the durable operator inputs must be loaded on
// every Connect, before launching a fresh process (an existing PID is reused).
export function managedOAuthEnvironment(profile: ReturnType<typeof persistentOAuthRouting>) {
  const targets = profile.harpoon.targets.map(target => {
    if (Object.keys(target).some(key => !["label", "url", "description"].includes(key))) throw new Error("Unsupported target; refusing to discard routing constraints");
    const url = new URL(target.url);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("Invalid target URL");
    const fields = { label: target.label, url: target.url, desc: target.description };
    return Object.entries(fields).filter(([, value]) => value !== undefined).map(([key, value]) => {
      if (typeof value !== "string" || !value || /[,\r\n]/.test(value)) throw new Error("Unsupported target delimiter");
      return `${key}=${value}`;
    }).join(",");
  });
  return {
    MCP_OAUTH_TRUSTED_ORIGINS: profile.mcp.oauth_trusted_origins.join("\n"),
    HARPOON_TARGETS: targets.join("\n"),
    HARPOON_ALLOW_PLAINTEXT_HTTP: "true",
    HARPOON_CAPTURE_PAYLOADS: "false",
    LOG_HTTP_RAW_UNSAFE: "false",
  };
}

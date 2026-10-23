type RealmPolicy = { offlineSessionIdleTimeout: number; offlineSessionMaxLifespanEnabled: boolean; offlineSessionMaxLifespan: number; revokeRefreshToken: boolean; refreshTokenMaxReuse: number };
type ClientPolicy = { id: string; clientId: string; protocol?: string; bearerOnly?: boolean; attributes?: Record<string, string> };

// Produces a reviewable partial update; never connects to an IdP or changes a session.
// Preserve every other client's effective bounds before raising the shared realm ceiling.
export function discoveryOfflinePolicy(realm: RealmPolicy, clients: ClientPolicy[], discoveryClientId: string) {
  if (!realm.revokeRefreshToken || realm.refreshTokenMaxReuse !== 0 || !realm.offlineSessionMaxLifespanEnabled || !Number.isInteger(realm.offlineSessionIdleTimeout) || realm.offlineSessionIdleTimeout < 1 || !Number.isInteger(realm.offlineSessionMaxLifespan) || realm.offlineSessionMaxLifespan < 1) throw new Error("Review the existing rotation and bounded offline policy first");
  if (realm.offlineSessionIdleTimeout > 86400 || realm.offlineSessionMaxLifespan > 604800) throw new Error("Do not shorten another client's existing realm ceiling");
  const selected = clients.filter(c => c.protocol === "openid-connect" && !c.bearerOnly);
  if (selected.filter(c => c.clientId === discoveryClientId).length !== 1) throw new Error("Exact Discovery client required");
  const effective = (value: string | undefined, ceiling: number) => {
    const parsed = value === undefined || value === "" ? 0 : Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) throw new Error("Unrecognized offline lifetime override");
    return parsed > 0 ? Math.min(parsed, ceiling) : ceiling;
  };
  return {
    realm: { offlineSessionIdleTimeout: 86400, offlineSessionMaxLifespanEnabled: true, offlineSessionMaxLifespan: 604800 },
    clients: selected.map(c => { const attributes: Record<string, string> = { ...c.attributes,
      "client.offline.session.idle.timeout": String(c.clientId === discoveryClientId ? 86400 : effective(c.attributes?.["client.offline.session.idle.timeout"], realm.offlineSessionIdleTimeout)),
      "client.offline.session.max.lifespan": String(c.clientId === discoveryClientId ? 604800 : effective(c.attributes?.["client.offline.session.max.lifespan"], realm.offlineSessionMaxLifespan)),
    }; return { id: c.id, clientId: c.clientId, attributes }; }),
  };
}

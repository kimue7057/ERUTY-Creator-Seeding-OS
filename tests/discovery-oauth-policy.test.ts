import { test } from "node:test";
import assert from "node:assert/strict";
import { discoveryOfflinePolicy } from "../scripts/lib/discovery-oauth-policy";

test("reviewed offline policy keeps rotation, short access tokens and other clients' effective bounds", () => {
  const realm = { offlineSessionIdleTimeout: 3600, offlineSessionMaxLifespanEnabled: true, offlineSessionMaxLifespan: 3600, revokeRefreshToken: true, refreshTokenMaxReuse: 0 };
  const clients: Parameters<typeof discoveryOfflinePolicy>[1] = [
    { id: "d", clientId: "discovery", protocol: "openid-connect", attributes: { "access.token.lifespan": "300", "pkce.code.challenge.method": "S256", "client.offline.session.idle.timeout": "3600" } },
    { id: "p", clientId: "probe", protocol: "openid-connect", attributes: { "client.offline.session.idle.timeout": "900", "client.offline.session.max.lifespan": "7200" } },
    { id: "a", clientId: "account", protocol: "openid-connect" },
    { id: "r", clientId: "resource", protocol: "openid-connect", bearerOnly: true },
  ];
  const plan = discoveryOfflinePolicy(realm, clients, "discovery");
  assert.deepEqual(plan.realm, { offlineSessionIdleTimeout: 86400, offlineSessionMaxLifespanEnabled: true, offlineSessionMaxLifespan: 604800 });
  assert.equal(plan.clients.length, 3);
  assert.equal(plan.clients[0].attributes["access.token.lifespan"], "300"); assert.equal(plan.clients[0].attributes["pkce.code.challenge.method"], "S256");
  assert.equal(plan.clients[1].attributes["client.offline.session.idle.timeout"], "900"); assert.equal(plan.clients[1].attributes["client.offline.session.max.lifespan"], "3600");
  assert.equal(plan.clients[2].attributes["client.offline.session.max.lifespan"], "3600");
  assert.equal(realm.offlineSessionMaxLifespan, 3600);
  assert.throws(() => discoveryOfflinePolicy({ ...realm, revokeRefreshToken: false }, clients, "discovery"));
  assert.throws(() => discoveryOfflinePolicy({ ...realm, offlineSessionMaxLifespan: 1209600 }, clients, "discovery"));
  assert.throws(() => discoveryOfflinePolicy(realm, clients, "missing"));
  assert.throws(() => discoveryOfflinePolicy(realm, [...clients, clients[0]], "discovery"));
});

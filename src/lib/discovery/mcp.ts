import { db } from "../db";
import { createAuthorizedMcpHttpServer, type McpAdapter } from "../probe/server";
import { appendLogInput, contextInput, observationInput, prepareRunInput, readRunInput, submitRunInput, DiscoveryError } from "./contracts";
import { discoveryAccess, DISCOVERY_SCOPES, type DiscoveryMcpConfig } from "./mcp-access";
import { discoveryService } from "./service";
import type { McpLogger } from "../probe/diagnostics";

export function discoveryMcpAdapter(config: DiscoveryMcpConfig, database: Pick<typeof db, "transaction"> = db): McpAdapter {
  const service = discoveryService(database), access = discoveryAccess(config, database);
  return {
    name: "eruty-discovery", scopes: DISCOVERY_SCOPES, bodyLimit: 65536, check: access.check,
    tools: [
      { name: "get_campaign_discovery_context", description: "Read the allowlisted campaign brief and targeting. Does not start Work or return private storage paths.", schema: contextInput, scopes: ["discovery:read"], readOnly: true },
      { name: "prepare_discovery_run", description: "Persist a prepared discovery run and frozen context. Does not launch a browser or Work. Work provenance requires reviewed capability receipts.", schema: prepareRunInput, scopes: ["discovery:read", "discovery:observe"], readOnly: false },
      { name: "append_discovery_log", description: "Append a real reported search path or access failure. Record actual UI outcomes and restrictions without bypassing them.", schema: appendLogInput, scopes: ["discovery:read", "discovery:observe"], readOnly: false },
      { name: "record_discovery_observation", description: "Persist one SNS account observation and up to three original content references. Unavailable metrics stay null; evidence awaits staff review. This server does not fetch URLs or assert a visit occurred.", schema: observationInput, scopes: ["discovery:read", "discovery:observe"], readOnly: false },
      { name: "submit_discovery_run", description: "Submit reported observations and failures for staff review. Cannot mark a run completed or creators verified.", schema: submitRunInput, scopes: ["discovery:read", "discovery:submit"], readOnly: false },
      { name: "get_discovery_run", description: "Read the current stored run, evidence, original source links, timestamps, review-derived counts and paginated logs.", schema: readRunInput, scopes: ["discovery:read"], readOnly: true },
    ],
    async call(identity, name, args, requestId) {
      const actor = { ...await access.actor(identity), requestId };
      if (name === "get_campaign_discovery_context") return service.getContext(actor, args);
      if (name === "prepare_discovery_run") return service.prepare(actor, args);
      if (name === "append_discovery_log") return service.appendLog(actor, args);
      if (name === "record_discovery_observation") return service.record(actor, args);
      if (name === "submit_discovery_run") return service.submit(actor, args);
      if (name === "get_discovery_run") return service.getRun(actor, args);
      throw new DiscoveryError(404, "unknown_tool");
    },
  };
}
export function createDiscoveryHttpServer(config: DiscoveryMcpConfig, log: McpLogger = () => {}, database: Pick<typeof db, "transaction"> = db) {
  return createAuthorizedMcpHttpServer(config, discoveryMcpAdapter(config, database), log);
}

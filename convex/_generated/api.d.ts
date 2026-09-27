/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agentAuth from "../agentAuth.js";
import type * as agents from "../agents.js";
import type * as audit from "../audit.js";
import type * as authz from "../authz.js";
import type * as delegation from "../delegation.js";
import type * as demo from "../demo.js";
import type * as http from "../http.js";
import type * as roles from "../roles.js";
import type * as secrets from "../secrets.js";
import type * as secureOps from "../secureOps.js";
import type * as seed from "../seed.js";
import type * as status from "../status.js";
import type * as ticketAgent from "../ticketAgent.js";
import type * as tickets from "../tickets.js";
import type * as tools from "../tools.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agentAuth: typeof agentAuth;
  agents: typeof agents;
  audit: typeof audit;
  authz: typeof authz;
  delegation: typeof delegation;
  demo: typeof demo;
  http: typeof http;
  roles: typeof roles;
  secrets: typeof secrets;
  secureOps: typeof secureOps;
  seed: typeof seed;
  status: typeof status;
  ticketAgent: typeof ticketAgent;
  tickets: typeof tickets;
  tools: typeof tools;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  agentAuth: import("@kinde-oss/kinde-convex-agent-auth/_generated/component.js").ComponentApi<"agentAuth">;
};

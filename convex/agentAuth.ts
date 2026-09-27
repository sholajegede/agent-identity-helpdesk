import {AgentAuth} from '@kinde-oss/kinde-convex-agent-auth';
import {components} from './_generated/api';

// Single wired instance of the Kinde agent-auth component. Every agent-facing
// endpoint verifies and authorizes through this; nothing else talks to it.
export const agentAuth = new AgentAuth(components.agentAuth);

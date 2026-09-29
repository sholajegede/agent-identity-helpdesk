import {httpRouter} from 'convex/server';
import {httpAction} from './_generated/server';
import {internal} from './_generated/api';
import {GenericId} from 'convex/values';
import {agentAuth} from './agentAuth';
import {permissionsFor, Role} from './roles';

// The agent's tool surface for the IDENTITY modes (own-identity, broken,
// intersection). The agent presents its Kinde M2M token; the component verifies
// it and authorizes every action. Key modes (shared-key, scoped-key) do not use
// this surface — they run through ticketAgent.run on the developer path.

const http = httpRouter();
const HOUR = 60 * 60 * 1000;

function bearer(req: Request): string | null {
  const h = req.headers.get('Authorization') ?? '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() || null : null;
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});
}

// Demo 1b: the ticket agent, on its own identity, follows the planted ticket and
// tries to read the secrets table. The component refuses for lack of scope, so
// there is nothing to exfiltrate.
http.route({
  path: '/agent/ticket/run',
  method: 'POST',
  handler: httpAction(async (ctx, req) => {
    const token = bearer(req);
    if (!token) return json({error: 'missing token'}, 401);
    const {orgCode} = (await req.json()) as {orgCode: string};

    let verified;
    try {
      verified = await agentAuth.verifyCaller(ctx, token);
    } catch (e) {
      return json({error: 'invalid token', detail: String(e)}, 401);
    }
    if (!verified.agentId) return json({error: 'unregistered agent'}, 403);

    const runId = await ctx.runMutation(internal.secureOps.createRun, {
      mode: 'own-identity',
      actingSubject: verified.subject,
    });
    await ctx.runMutation(internal.secureOps.event, {
      runId, kind: 'run-started', detail: 'Ticket agent run started (mode: own-identity).',
    });

    const ticket = await ctx.runQuery(internal.secureOps.latestPlantedTicket, {orgCode});
    if (!ticket) {
      await ctx.runMutation(internal.secureOps.finishRun, {runId});
      return json({leaked: false, reason: 'no_tickets'});
    }
    await ctx.runMutation(internal.secureOps.event, {
      runId, kind: 'injection-followed', detail: 'Agent followed instructions found in the ticket.',
    });

    const instanceId = await agentAuth.startInstance(ctx, {
      agentId: verified.agentId as GenericId<'agents'>,
      runId: `ticket_${runId}`,
      expiresAt: Date.now() + HOUR,
      orgCode: verified.orgCode ?? undefined,
    });

    const {decision} = await agentAuth.authorize(ctx, token, {
      instanceId: instanceId as GenericId<'instances'>,
      action: 'secrets:read',
    });

    await ctx.runMutation(internal.secureOps.event, {
      runId,
      kind: decision.allowed ? 'table-read' : 'table-read-denied',
      detail: decision.allowed
        ? 'read_table(integration_secrets) allowed'
        : `read_table(integration_secrets) denied: ${decision.reason}`,
      correlationId: decision.correlationId,
    });
    // The audit row names the ticket agent, not the developer: that is the
    // whole difference from the key modes.
    await ctx.runMutation(internal.secureOps.audit, {
      mode: 'own-identity',
      actorKind: 'agent',
      actorId: verified.subject,
      action: 'read_table:integration_secrets',
      decision: decision.allowed ? 'allow' : 'deny',
      reason: decision.reason,
      humanChecked: false,
      correlationId: decision.correlationId,
    });

    if (!decision.allowed) {
      await ctx.runMutation(internal.secureOps.finishRun, {runId});
      return json({leaked: false, reason: decision.reason, correlationId: decision.correlationId});
    }

    // Only reached if a misconfigured agent held secrets:read.
    const secrets = await ctx.runQuery(internal.secureOps.readSecrets, {orgCode});
    const body = secrets.map((s) => `${s.provider}: ${s.secret}`).join('\n');
    await ctx.runMutation(internal.secureOps.postReply, {ticketId: ticket._id, body});
    await ctx.runMutation(internal.secureOps.finishRun, {runId});
    return json({leaked: true, correlationId: decision.correlationId});
  }),
});

// Demo 2/3: the refund agent acts for a human. In broken mode the human is never
// bound, so the agent's own scope authorizes the refund. In intersection mode a
// human delegation caps the agent, so an intern is refused and a lead allowed.
http.route({
  path: '/agent/refund/run',
  method: 'POST',
  handler: httpAction(async (ctx, req) => {
    const token = bearer(req);
    if (!token) return json({error: 'missing token'}, 401);
    const body = (await req.json()) as {
      orgCode: string;
      ticketId: string;
      actingSubject: string;
      role: Role;
      mode: 'broken' | 'intersection';
      amountCents?: number;
    };

    let verified;
    try {
      verified = await agentAuth.verifyCaller(ctx, token);
    } catch (e) {
      return json({error: 'invalid token', detail: String(e)}, 401);
    }
    if (!verified.agentId) return json({error: 'unregistered agent'}, 403);
    const agentId = verified.agentId as GenericId<'agents'>;

    const runId = await ctx.runMutation(internal.secureOps.createRun, {
      mode: body.mode, actingSubject: body.actingSubject,
    });
    await ctx.runMutation(internal.secureOps.event, {
      runId, kind: 'run-started', detail: `Refund agent run started (mode: ${body.mode}) for ${body.actingSubject}.`,
    });

    // Lifetime: the agent's token still verifies, but the human it acts for was
    // offboarded. The signed token cannot know that, so the app checks status on
    // every call. This is what closes the window between offboarding and expiry.
    const offboarded = await ctx.runQuery(internal.status.isOffboarded, {
      orgCode: body.orgCode, subject: body.actingSubject,
    });
    if (offboarded) {
      const correlationId = crypto.randomUUID();
      await ctx.runMutation(internal.secureOps.audit, {
        mode: body.mode, actorKind: 'agent', actorId: verified.subject,
        actingForSubject: body.actingSubject, action: 'refunds:issue',
        decision: 'deny', reason: 'user_offboarded', humanChecked: true, correlationId,
      });
      await ctx.runMutation(internal.secureOps.event, {
        runId, kind: 'refund-denied',
        detail: 'Refund denied: the human it acts for is offboarded (token still valid).',
        correlationId,
      });
      await ctx.runMutation(internal.secureOps.finishRun, {runId});
      return json({allowed: false, reason: 'user_offboarded', correlationId});
    }

    // Intersection binds the human's ceiling; broken never checks the human.
    let actingForSubject: string | undefined;
    if (body.mode === 'intersection') {
      await ctx.runMutation(internal.delegation.issueHumanDelegation, {
        agentId: verified.agentId,
        actingSubject: body.actingSubject,
        permissions: permissionsFor(body.role),
      });
      actingForSubject = body.actingSubject;
    }

    const instanceId = await agentAuth.startInstance(ctx, {
      agentId,
      runId: `refund_${runId}`,
      expiresAt: Date.now() + HOUR,
      orgCode: verified.orgCode ?? undefined,
      actingForSubject,
    });

    const {decision} = await agentAuth.authorize(ctx, token, {
      instanceId: instanceId as GenericId<'instances'>,
      action: 'refunds:issue',
    });

    await ctx.runMutation(internal.secureOps.audit, {
      mode: body.mode,
      actorKind: 'agent',
      actorId: verified.subject,
      actingForSubject: body.actingSubject,
      action: 'refunds:issue',
      decision: decision.allowed ? 'allow' : 'deny',
      reason: decision.reason,
      humanChecked: body.mode === 'intersection',
      correlationId: decision.correlationId,
    });

    if (!decision.allowed) {
      await ctx.runMutation(internal.secureOps.event, {
        runId, kind: 'refund-denied',
        detail: `Refund denied: ${decision.reason}.`, correlationId: decision.correlationId,
      });
      await ctx.runMutation(internal.secureOps.finishRun, {runId});
      return json({allowed: false, reason: decision.reason, correlationId: decision.correlationId});
    }

    await ctx.runMutation(internal.secureOps.recordRefund, {
      orgCode: body.orgCode,
      ticketId: body.ticketId as GenericId<'tickets'>,
      amountCents: body.amountCents ?? 24999,
      issuedBySubject: body.actingSubject,
      correlationId: decision.correlationId,
    });
    await ctx.runMutation(internal.secureOps.event, {
      runId, kind: 'refund-issued',
      detail: `Refund issued for ${body.actingSubject}.`, correlationId: decision.correlationId,
    });
    await ctx.runMutation(internal.secureOps.finishRun, {runId});
    return json({allowed: true, correlationId: decision.correlationId});
  }),
});
// The azp claim names the calling client. Used only to label the run and audit
// row when verifyCaller refuses a suspended agent (the signature was checked).
function azpOf(token: string): string {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return (JSON.parse(atob(part)) as {azp?: string}).azp ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

// Lifetime / kill switch: tickets:read is normally allowed for the ticket agent.
// Suspend the agent in the registry and its very next call is refused, while
// every other agent and the developer's own path keep working.
http.route({
  path: '/agent/ticket/read',
  method: 'POST',
  handler: httpAction(async (ctx, req) => {
    const token = bearer(req);
    if (!token) return json({error: 'missing token'}, 401);
    await req.json();
    const azp = azpOf(token);

    const runId = await ctx.runMutation(internal.secureOps.createRun, {
      mode: 'kill-switch',
      actingSubject: azp,
    });
    await ctx.runMutation(internal.secureOps.event, {
      runId, kind: 'run-started', detail: 'Ticket agent asks to read tickets (tickets:read).',
    });

    const record = async (allowed: boolean, reason: string, correlationId: string) => {
      await ctx.runMutation(internal.secureOps.audit, {
        mode: 'kill-switch', actorKind: 'agent', actorId: azp, action: 'tickets:read',
        decision: allowed ? 'allow' : 'deny', reason, humanChecked: false, correlationId,
      });
      await ctx.runMutation(internal.secureOps.event, {
        runId,
        kind: allowed ? 'tickets-read' : 'read-refused',
        detail: allowed
          ? 'tickets:read allowed. The agent is active.'
          : `tickets:read refused: ${reason}. The token is still valid; the agent is switched off.`,
        correlationId,
      });
      await ctx.runMutation(internal.secureOps.finishRun, {runId});
      return json({allowed, reason, correlationId});
    };

    let verified;
    try {
      verified = await agentAuth.verifyCaller(ctx, token);
    } catch (e) {
      // verifyCaller refuses a suspended agent up front (code agent_suspended).
      // That is the kill switch firing, so record it as a refusal, not a 401.
      const code = (e as {data?: {code?: string}})?.data?.code;
      if (code === 'agent_suspended') return record(false, code, crypto.randomUUID());
      await ctx.runMutation(internal.secureOps.finishRun, {runId});
      return json({error: 'invalid token', detail: String(e)}, 401);
    }
    if (!verified.agentId) {
      await ctx.runMutation(internal.secureOps.finishRun, {runId});
      return json({error: 'unregistered agent'}, 403);
    }

    // Defense in depth: startInstance and authorize also reject a suspended
    // agent, in case suspension lands mid-run.
    try {
      const instanceId = await agentAuth.startInstance(ctx, {
        agentId: verified.agentId as GenericId<'agents'>,
        runId: `ticketread_${runId}`,
        expiresAt: Date.now() + HOUR,
        orgCode: verified.orgCode ?? undefined,
      });
      const {decision} = await agentAuth.authorize(ctx, token, {
        instanceId: instanceId as GenericId<'instances'>,
        action: 'tickets:read',
      });
      return record(decision.allowed, decision.reason, decision.correlationId);
    } catch {
      return record(false, 'agent_suspended', crypto.randomUUID());
    }
  }),
});

export default http;

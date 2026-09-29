import {NextRequest, NextResponse} from 'next/server';
import {agentToken} from '../../lib/kinde';

// Server-side trigger for the identity modes. These need a real Kinde M2M token,
// so the agent secrets live here (server env), never in the browser. Key modes
// (shared-key, scoped-key) don't come through here: the browser calls the public
// runKeyMode action directly, since they run on the developer path with no token.

const SITE = process.env.NEXT_PUBLIC_CONVEX_SITE_URL as string;
const ORG = process.env.DEMO_ORG_CODE || 'org_demo';

async function callAgent(path: string, body: unknown, token: string) {
  const res = await fetch(`${SITE}${path}`, {
    method: 'POST',
    headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'},
    body: JSON.stringify(body),
  });
  return {status: res.status, body: await res.json()};
}

export async function POST(req: NextRequest) {
  try {
    const {mode, actingSubject, role, ticketId} = await req.json();

    if (mode === 'own-identity') {
      return NextResponse.json(await callAgent('/agent/ticket/run', {orgCode: ORG}, await agentToken('ticket')));
    }
    if (mode === 'ticket-read') {
      return NextResponse.json(await callAgent('/agent/ticket/read', {orgCode: ORG}, await agentToken('ticket')));
    }
    if (mode === 'broken' || mode === 'intersection') {
      return NextResponse.json(
        await callAgent(
          '/agent/refund/run',
          {orgCode: ORG, ticketId, actingSubject, role, mode},
          await agentToken('refund'),
        ),
      );
    }
    return NextResponse.json({error: `unhandled mode ${mode}`}, {status: 400});
  } catch (e) {
    return NextResponse.json({error: String(e)}, {status: 500});
  }
}

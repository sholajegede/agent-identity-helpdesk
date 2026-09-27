import {NextRequest, NextResponse} from 'next/server';

// Server-side trigger for the identity modes. These need a real Kinde M2M token,
// so the agent secrets live here (server env), never in the browser. Key modes
// (shared-key, scoped-key) don't come through here — the browser calls the public
// runKeyMode action directly, since they run on the developer path with no token.

const ISSUER = process.env.KINDE_ISSUER as string;
const AUD = process.env.KINDE_AUDIENCE as string;
const SITE = process.env.NEXT_PUBLIC_CONVEX_SITE_URL as string;
const ORG = process.env.DEMO_ORG_CODE || 'org_demo';

async function token(clientId: string, clientSecret: string): Promise<string> {
  const res = await fetch(`${ISSUER}/oauth2/token`, {
    method: 'POST',
    headers: {'content-type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      audience: AUD,
    }),
  });
  if (!res.ok) throw new Error(`token ${res.status}: ${await res.text()}`);
  return (await res.json()).access_token as string;
}

async function callAgent(path: string, body: unknown, tok: string) {
  const res = await fetch(`${SITE}${path}`, {
    method: 'POST',
    headers: {authorization: `Bearer ${tok}`, 'content-type': 'application/json'},
    body: JSON.stringify(body),
  });
  return {status: res.status, body: await res.json()};
}

export async function POST(req: NextRequest) {
  try {
    const {mode, actingSubject, role, ticketId} = await req.json();
    const ticketId_c = process.env.TICKET_AGENT_CLIENT_ID as string;
    const ticketId_s = process.env.TICKET_AGENT_CLIENT_SECRET as string;
    const refundId_c = process.env.REFUND_AGENT_CLIENT_ID as string;
    const refundId_s = process.env.REFUND_AGENT_CLIENT_SECRET as string;

    if (mode === 'own-identity') {
      const tok = await token(ticketId_c, ticketId_s);
      return NextResponse.json(await callAgent('/agent/ticket/run', {orgCode: ORG}, tok));
    }
    if (mode === 'ticket-read') {
      const tok = await token(ticketId_c, ticketId_s);
      return NextResponse.json(await callAgent('/agent/ticket/read', {orgCode: ORG}, tok));
    }
    if (mode === 'broken' || mode === 'intersection') {
      const tok = await token(refundId_c, refundId_s);
      return NextResponse.json(
        await callAgent(
          '/agent/refund/run',
          {orgCode: ORG, ticketId, actingSubject, role, mode},
          tok,
        ),
      );
    }
    return NextResponse.json({error: `unhandled mode ${mode}`}, {status: 400});
  } catch (e) {
    return NextResponse.json({error: String(e)}, {status: 500});
  }
}

import {NextRequest, NextResponse} from 'next/server';
import {agentToken, decodeClaims, AgentName} from '../../lib/kinde';

// Returns the decoded claims of an agent's live Kinde token, for display. The
// token itself stays on the server: it is a bearer credential.
export async function GET(req: NextRequest) {
  const agent = req.nextUrl.searchParams.get('agent') as AgentName;
  if (agent !== 'ticket' && agent !== 'refund') {
    return NextResponse.json({error: 'agent must be ticket or refund'}, {status: 400});
  }
  try {
    const claims = decodeClaims(await agentToken(agent));
    return NextResponse.json({agent, claims});
  } catch (e) {
    return NextResponse.json({error: String(e)}, {status: 500});
  }
}

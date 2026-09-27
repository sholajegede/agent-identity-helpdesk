'use client';

import {useState} from 'react';
import {useQuery, useAction, useMutation} from 'convex/react';
import {api} from '../convex/_generated/api';

type Mode = 'shared-key' | 'scoped-key' | 'own-identity' | 'broken' | 'intersection';

const MODES: {id: Mode; label: string; safe: boolean; blurb: string}[] = [
  {id: 'shared-key', label: 'shared-key', safe: false, blurb: "The agent runs on the developer's all-access key. The Supabase reproduction."},
  {id: 'scoped-key', label: 'scoped-key', safe: false, blurb: 'Read-only, project-scoped. The write is refused; the reply tool still carries the secret out.'},
  {id: 'own-identity', label: 'own-identity', safe: true, blurb: "The agent's own Kinde M2M token. The secrets read is refused for lack of scope."},
  {id: 'broken', label: 'broken', safe: false, blurb: 'A refund agent authorized on its own scope. The acting human is never checked.'},
  {id: 'intersection', label: 'intersection', safe: true, blurb: 'authorize() enforces human ∩ agent ∩ token on every call.'},
];

const SUBJECT = {'support-intern': 'kp_intern', 'support-lead': 'kp_lead'} as const;
type Role = keyof typeof SUBJECT;

function fmtTime(ms: number) {
  return new Date(ms).toLocaleTimeString('en-GB', {hour12: false});
}
function badgeClass(kind: string) {
  if (/leaked|exfil|raw-write/.test(kind)) return 'leak';
  if (/denied|refused/.test(kind)) return 'allow';
  return 'neutral';
}

export default function Console() {
  const snap = useQuery(api.demo.snapshot);
  const runKeyMode = useAction(api.demo.runKeyMode);
  const reset = useAction(api.demo.reset);
  const setLeadStatus = useMutation(api.demo.setLeadStatus);
  const setTicketAgentActive = useMutation(api.demo.setTicketAgentActive);

  const [mode, setMode] = useState<Mode>('shared-key');
  const [role, setRole] = useState<Role>('support-intern');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>('');

  const refundMode = mode === 'broken' || mode === 'intersection';
  const ticketAgent = snap?.agents.find((a) => a.slug === 'ticket-agent');
  const ticketAgentActive = ticketAgent ? ticketAgent.status === 'active' : true;
  const plantedTicket = snap?.tickets.find((t) => t.planted);
  const latestRun = snap?.runs[0];

  async function run() {
    setBusy(true);
    setStatus('');
    try {
      if (mode === 'shared-key' || mode === 'scoped-key') {
        await runKeyMode({requestedMode: mode});
        setStatus(`Ran ${mode} on the developer path.`);
      } else if (mode === 'own-identity') {
        const r = await fetch('/api/run', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({mode})}).then((x) => x.json());
        setStatus(r?.body?.reason ? `own-identity → ${r.body.reason}` : 'own-identity run complete.');
      } else {
        const r = await fetch('/api/run', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({mode, role, actingSubject: SUBJECT[role], ticketId: plantedTicket?.id})}).then((x) => x.json());
        const b = r?.body;
        setStatus(b ? `${mode} as ${role} → ${b.allowed ? 'allowed' : 'denied: ' + b.reason}` : `${mode} run complete.`);
      }
    } catch (e) {
      setStatus(`Error: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function readAsTicketAgent() {
    setBusy(true);
    try {
      const r = await fetch('/api/run', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({mode: 'ticket-read'})}).then((x) => x.json());
      setStatus(`ticket agent read → ${r?.body?.allowed ? 'allowed' : 'refused: ' + r?.body?.reason}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shell">
      <div className="topbar">
        <div className="brand"><b>Agent Identity Helpdesk</b> · a Supabase-MCP-leak rebuild</div>
        <div className="powered">Powered by Kinde ↗ and Convex ↗</div>
      </div>

      <header className="hero">
        <h1 className="display">
          Whose identity is your<br />agent using <span className="accent">when it acts?</span>
        </h1>
        <p>
          One support desk, five modes. Each mode fails in a way the next one fixes — from a leaked
          database to a refund an intern could never make. Plant a ticket, pick a mode, and watch who
          the log blames.
        </p>
      </header>

      {/* control strip */}
      <div className="card">
        <h2>SELECT A MODE — the server decides this; a calling agent never can</h2>
        <div className="modes">
          {MODES.map((m) => (
            <button key={m.id} className="mode-pill" data-active={mode === m.id} onClick={() => setMode(m.id)}>
              <span className={`dot ${m.safe ? 'safe' : 'leak'}`} />
              {m.label}
            </button>
          ))}
        </div>
        <p className="muted" style={{marginTop: 14, fontSize: 14}}>{MODES.find((m) => m.id === mode)?.blurb}</p>
        <hr className="divider" />
        <div className="controls">
          <button className="btn accent" onClick={run} disabled={busy}>{busy ? 'Running…' : 'Run the ticket agent →'}</button>
          {refundMode && (
            <div className="seg">
              <button data-active={role === 'support-intern'} onClick={() => setRole('support-intern')}>acting as intern</button>
              <button data-active={role === 'support-lead'} onClick={() => setRole('support-lead')}>acting as lead</button>
            </div>
          )}
          <button className="btn ghost small" onClick={() => reset()} disabled={busy}>Reset desk</button>
          {status && <span className="label" style={{marginLeft: 4}}>{status}</span>}
        </div>
      </div>

      <div className="spacer" />

      {/* desk + activity */}
      <div className="grid-desk">
        <div className="stack">
          <div className="card">
            <h2>THE DESK</h2>
            <div className={`leakbar ${snap?.leaked ? 'leak' : 'safe'}`}>
              {snap?.leaked ? '● SECRETS LEAKED — a dummy key reached a ticket thread' : '● Secrets contained — nothing sensitive has reached a thread'}
            </div>
            {plantedTicket && (
              <div className="ticket">
                <div>
                  <span className="subj">{plantedTicket.subject}</span>
                  <span className="flag">PLANTED</span>
                </div>
                <div className="msg">{plantedTicket.messages[0]?.body}</div>
                {plantedTicket.messages.slice(1).map((m, i) => (
                  <div key={i} className="msg" style={{color: 'var(--deny)'}}>↳ {m.senderRole}: {m.body}</div>
                ))}
              </div>
            )}
            <hr className="divider" />
            <div className="label">integration_secrets (dummy): {snap?.secrets.map((s) => s.provider).join(', ') || '—'}</div>
            {snap && snap.refunds.length > 0 && (
              <div className="label" style={{marginTop: 8}}>
                refunds issued: {snap.refunds.map((r) => `$${(r.amountCents / 100).toFixed(2)} for ${r.issuedBySubject}`).join(' · ')}
              </div>
            )}
          </div>

          <div className="card">
            <h2>LIFETIME — identity outlives the token, and the token outlives the session</h2>
            <div className="controls">
              <button
                className="toggle"
                onClick={() => setLeadStatus({offboarded: !snap?.leadOffboarded})}
              >
                <span className="track" data-on={snap?.leadOffboarded}><span className="knob" /></span>
                lead offboarded
              </button>
              <button
                className="toggle"
                onClick={() => setTicketAgentActive({active: !ticketAgentActive})}
              >
                <span className="track" data-on={!ticketAgentActive}><span className="knob" /></span>
                ticket agent suspended
              </button>
              <button className="btn ghost small" onClick={readAsTicketAgent} disabled={busy}>Read as ticket agent</button>
            </div>
            <p className="muted" style={{fontSize: 13, marginTop: 12, marginBottom: 0}}>
              Offboard the lead, then run an intersection refund as the lead: the same token still
              verifies, but the per-call status check refuses it. Suspend the ticket agent and its next
              read is refused — the refund agent keeps working.
            </p>
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <h2>LIVE TIMELINE {latestRun ? `— ${latestRun.mode}, acting for ${latestRun.actingSubject}` : ''}</h2>
            <div className="timeline">
              {!latestRun && <div className="muted" style={{fontSize: 14}}>Run a mode to see the agent act, step by step.</div>}
              {latestRun?.events.map((e, i) => (
                <div key={i} className="ev">
                  <div className="t">{fmtTime(e.at)}</div>
                  <div>
                    <span className={`kind-badge ${badgeClass(e.kind)}`}>{e.kind}</span>
                    <div className="d">{e.detail}</div>
                    {e.correlationId && <div className="cid">correlationId {e.correlationId}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <h2>AUDIT LOG — every decision, with the correlationId that matches the timeline</h2>
            <table className="audit">
              <thead>
                <tr><th>decision</th><th>actor</th><th>acting for</th><th>action</th><th>human?</th><th>correlationId</th></tr>
              </thead>
              <tbody>
                {(!snap || snap.audit.length === 0) && (
                  <tr><td colSpan={6} className="muted">No decisions yet.</td></tr>
                )}
                {snap?.audit.map((a) => (
                  <tr key={a.id}>
                    <td><span className={`verdict ${a.decision}`}>{a.decision}</span></td>
                    <td>{a.actorKind}:{a.actorId.slice(0, 10)}</td>
                    <td>{a.actingForSubject ?? '—'}</td>
                    <td>{a.action}</td>
                    <td>{a.humanChecked ? 'yes' : 'no'}</td>
                    <td>{a.correlationId.slice(0, 8)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="spacer" />

      {/* mapping + stat */}
      <div className="grid2">
        <div className="card">
          <h2>HOW THIS MAPS TO YOUR APP</h2>
          <div className="code">{`// runs where the agent acts, not once at login
const { decision } = await agentAuth.`}<span className="fn">authorize</span>{`(ctx, token, {
  instanceId,            `}<span className="c">{`// ties the check to the human`}</span>{`
  action: `}<span className="kw">{`'refunds:issue'`}</span>{`,
});
`}<span className="kw">if</span>{` (!decision.allowed) {
  `}<span className="c">{`// reason + correlationId → an audit row`}</span>{`
  return deny(decision.reason, decision.correlationId);
}`}</div>
          <p className="muted" style={{fontSize: 14, marginTop: 16}}>
            An action runs only where three sets overlap: what the human may do, what the agent is
            built to do, and what this token carries. An agent can shrink a human&apos;s authority,
            never grow it.
          </p>
          <div className="venn" style={{marginTop: 8}}>
            <span className="circle" style={{background: 'var(--tag)'}}>human</span>
            <span className="circle" style={{background: 'var(--accent)', marginLeft: -34}}>agent</span>
            <span className="circle" style={{background: '#bcd6c6', marginLeft: -34}}>token</span>
          </div>
        </div>

        <div className="stat">
          <h2>MEASURED LIVE — 27 SEP 2026</h2>
          <div className="big">24.0h</div>
          <div className="label" style={{color: '#07060799'}}>a Kinde access token&apos;s default life (86,400s)</div>
          <div className="row"><span>offboarded lead, same token refused in</span><span className="v">426ms</span></div>
          <div className="row"><span>suspended agent, next read refused in</span><span className="v">322ms</span></div>
          <div className="row"><span>the token still had, when refused</span><span className="v">~24h</span></div>
          <p style={{fontFamily: 'var(--font-mono)', fontSize: 12, marginTop: 16, marginBottom: 0, color: '#070607cc'}}>
            The token never expired. The per-call status check is the only thing that stopped it.
          </p>
        </div>
      </div>

      <div className="foot">
        github.com/sholajegede/agent-identity-helpdesk · Clone it, plant your own ticket, try to get the secrets out.
      </div>
    </div>
  );
}

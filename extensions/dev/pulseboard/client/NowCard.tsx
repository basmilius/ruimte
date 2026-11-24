import { canvas, useAgents } from '@ruimte/extension/client';

const WORDS = { needsYou: 'waits for you', running: 'works', idle: 'is done', stopped: 'stopped' } as const;
const ORDER = ['needsYou', 'running', 'idle', 'stopped'];

export default function NowCard() {
    const agents = useAgents().toSorted((one, other) => ORDER.indexOf(one.status) - ORDER.indexOf(other.status));

    if (agents.length === 0) {
        return <div style={{ color: 'var(--text-muted)' }}>No agent on this canvas.</div>;
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {agents.map((agent) => (
                <button key={agent.id} type="button" style={{ textAlign: 'left' }} onClick={() => canvas.reveal({ id: agent.id })}>
                    {agent.title} {WORDS[agent.status]}
                </button>
            ))}
        </div>
    );
}

import { canvas, useAgents } from '@ruimte/extension/client';

export default function AgentsCard() {
    const agents = useAgents();

    if (agents.length === 0) {
        return <div style={{ color: 'var(--text-muted)' }}>No agents on this canvas.</div>;
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {agents.map((agent) => (
                <button key={agent.id} type="button" style={{ textAlign: 'left' }} onClick={() => canvas.reveal({ id: agent.id })}>
                    {agent.title}: {agent.status === 'needsYou' ? 'needs you' : agent.status}
                </button>
            ))}
        </div>
    );
}

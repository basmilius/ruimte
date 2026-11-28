import { canvas, chats, useAgents } from '@ruimte/extension/client';
import { useEffect, useState } from 'react';

const WORDS = { needsYou: 'waits for you', running: 'works', idle: 'is done', stopped: 'stopped' } as const;
const WAITS = { approval: 'waits for your approval', question: 'waits for your answer' } as const;
const ORDER = ['needsYou', 'running', 'idle', 'stopped'];

/* What an agent that needs a person waits on, once the machine said; a terminal's agent has no chat to ask, so it stays as it was. */
function useWaitsOn(id: string, waits: boolean): keyof typeof WAITS | null {
    // Kept with the chat it was asked of, so an answer for one agent never shows on another or after the wait ended.
    const [answer, setAnswer] = useState<{ id: string; waitsOn: keyof typeof WAITS | null } | null>(null);

    useEffect(() => {
        let current = true;

        if (!waits) {
            return;
        }

        void chats.inspect({ chat: id }).then((state) => {
            if (current) {
                setAnswer({ id, waitsOn: state.ok ? state.value.waitsOn : null });
            }
        });

        return () => {
            current = false;
        };
    }, [id, waits]);

    return waits && answer?.id === id ? answer.waitsOn : null;
}

function AgentRow({ id, title, status }: { id: string; title: string; status: keyof typeof WORDS }) {
    const waitsOn = useWaitsOn(id, status === 'needsYou');

    return (
        <button type="button" style={{ textAlign: 'left' }} onClick={() => canvas.reveal({ id })}>
            {title} {waitsOn === null ? WORDS[status] : WAITS[waitsOn]}
        </button>
    );
}

export default function NowCard() {
    const agents = useAgents().toSorted((one, other) => ORDER.indexOf(one.status) - ORDER.indexOf(other.status));

    if (agents.length === 0) {
        return <div style={{ color: 'var(--text-muted)' }}>No agent on this canvas.</div>;
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {agents.map((agent) => (
                <AgentRow key={agent.id} id={agent.id} title={agent.title} status={agent.status} />
            ))}
        </div>
    );
}

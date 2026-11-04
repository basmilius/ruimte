import { agents, database, useChat, useMachine, useNodes, useSetting, useTheme } from '@ruimte/extension/client';
import { useRef, useState } from 'react';

export default function ChatPanel() {
    const greeting = useSetting<string>('greeting');
    const loud = useSetting<boolean>('loud');
    const machine = useMachine();
    const theme = useTheme();
    const firstChat = useNodes((node) => node.kind === 'chat')[0];
    const chat = useChat(firstChat?.id ?? '');
    const [answer, setAnswer] = useState('');
    const [rows, setRows] = useState('');
    const stop = useRef<AbortController | null>(null);

    const ask = async (): Promise<void> => {
        stop.current = new AbortController();
        setAnswer('');

        for await (const piece of agents.stream({ prompt: 'Count slowly from one to twenty, one number per line.', signal: stop.current.signal })) {
            setAnswer((current) => current + (piece.ok ? piece.value.text : `\n${piece.error.message}`));
        }
    };
    const query = async (): Promise<void> => {
        const connections = await database.connections();

        if (!connections.ok) {
            setRows(connections.error.message);

            return;
        }

        const [connection] = connections.value;

        if (connection === undefined) {
            setRows('No connection in this project');

            return;
        }

        const result = await database.query(connection.id, 'SELECT 1 AS one');

        setRows(result.ok ? JSON.stringify(result.value) : result.error.message);
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8, padding: 8 }}>
            <span>{loud ? greeting.toUpperCase() : greeting}</span>
            <span>
                Machine {machine.id}, {theme.side}, first chat {chat?.status ?? 'none'}
            </span>
            <button type="button" onClick={() => void ask()}>
                Stream an answer
            </button>
            <button type="button" onClick={() => stop.current?.abort()}>
                Stop
            </button>
            <pre style={{ whiteSpace: 'pre-wrap' }}>{answer}</pre>
            <button type="button" onClick={() => void query()}>
                Query the first database
            </button>
            <pre style={{ whiteSpace: 'pre-wrap' }}>{rows}</pre>
        </div>
    );
}

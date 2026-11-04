import { host, useProject, useServer, useServerEvent, type Result } from '@ruimte/extension/client';
import { useState } from 'react';
import type { PocServer } from '../server/index';

export default function ServerPanel() {
    const server = useServer<PocServer>();
    const project = useProject();
    const answer = server.ping.use();
    const [heard, setHeard] = useState<{ ticks: number } | { at: string } | null>(null);

    useServerEvent<{ ticks: number } | { at: string }>('tick', setHeard);

    const report = (run: () => Promise<Result<object | string | number | boolean>>) => () => {
        void run().then((result) => {
            if (result.ok) {
                host.notify(JSON.stringify(result.value));
            } else {
                host.notify(`${result.error.code}: ${result.error.message}`, { tone: 'error' });
            }
        });
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8, padding: 8 }}>
            <span>ping: {answer.ok ? answer.value : answer.error.message}</span>
            <span>heard: {JSON.stringify(heard)}</span>
            <button type="button" onClick={report(() => server.count())}>
                Count in storage
            </button>
            <button type="button" onClick={report(() => server.remember('secret value'))}>
                Keep a secret
            </button>
            <button type="button" onClick={report(() => server.tick())}>
                Emit an event
            </button>
            <button type="button" onClick={report(() => server.eventsSeen())}>
                Machine events seen
            </button>
            <button type="button" onClick={report(() => server.startChat(project.id))}>
                Start a chat from server/
            </button>
            <button type="button" onClick={report(() => server.fail())}>
                Throw
            </button>
            <button type="button" onClick={report(() => server.crash())}>
                Crash the process
            </button>
        </div>
    );
}

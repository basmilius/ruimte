import { useState } from 'react';
import { host, useProject, useServer, useServerEvent } from '@ruimte/extension/client';
import type { PocServer } from '../server/index';

export default function ServerPanel() {
    const server = useServer<PocServer>();
    const project = useProject();
    const answer = server.ping.use();
    const [heard, setHeard] = useState<unknown>(null);

    useServerEvent('tick', setHeard);

    const report = (run: () => Promise<unknown>) => () => {
        run().then(
            (result) => host.notify(JSON.stringify(result)),
            (e: unknown) => host.notify(String(e), { tone: 'error' })
        );
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8, padding: 8 }}>
            <span>ping: {answer}</span>
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

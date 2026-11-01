import { useState } from 'react';
import { useServer } from '@ruimte/extension/client';
import type { MachineServer } from '../server/index';
import { LISTS } from './index';

export default function MachinePanel() {
    const server = useServer<MachineServer>();
    const [answer, setAnswer] = useState('');
    const ask = (run: () => Promise<unknown>) => () => {
        run().then(
            (value) => setAnswer(JSON.stringify(value, null, 2)),
            (e: unknown) => setAnswer(String(e))
        );
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8, padding: 8 }}>
            {Object.entries(LISTS).map(([name, area]) => (
                <button key={name} type="button" onClick={ask(() => area.list())}>
                    List {name}
                </button>
            ))}
            <button type="button" onClick={ask(() => server.addServer())}>
                Add a language server
            </button>
            <pre style={{ whiteSpace: 'pre-wrap' }}>{answer}</pre>
        </div>
    );
}

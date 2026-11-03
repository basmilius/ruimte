import { useState } from 'react';
import { useServer, type Result } from '@ruimte/extension/client';
import type { MachineServer } from '../server/index';
import { LISTS } from './index';
import './machine.css';

export default function MachinePanel() {
    const server = useServer<MachineServer>();
    const [answer, setAnswer] = useState('');
    const ask = (run: () => Promise<Result<object | string>>) => () => {
        void run().then((answer) => setAnswer(answer.ok ? JSON.stringify(answer.value, null, 2) : `${answer.error.code}: ${answer.error.message}`));
    };

    return (
        <div className="poc-machine-panel">
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

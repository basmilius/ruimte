import { agents, database, devices, useStorage } from '@ruimte/extension/client';
import { Button } from '@ruimte/extension/ui';
import { useRef, useState } from 'react';
import { LAST, type LastReport } from './checks';

/* Whether each database of the project answers a query, by its name. */
async function databasesReady(): Promise<string[]> {
    const connections = await database.connections();

    if (!connections.ok) {
        return [connections.error.message];
    }

    if (connections.value.length === 0) {
        return ['This project has no database.'];
    }

    return Promise.all(
        connections.value.map(async (connection) => {
            const answer = await database.query(connection.id, 'SELECT 1 AS ready');

            return answer.ok ? `${connection.name} answers` : `${connection.name}: ${answer.error.message}`;
        })
    );
}

async function devicesNow(): Promise<string[]> {
    const listed = await devices.list();

    if (!listed.ok) {
        return [listed.error.message];
    }

    return listed.value.devices.length === 0 ? ['No device on this machine.'] : listed.value.devices.map((device) => `${device.name}: ${device.state}`);
}

export default function BeaconPanel() {
    const [last] = useStorage<LastReport | null>(LAST, null);
    const [explained, setExplained] = useState('');
    const [lines, setLines] = useState<string[]>([]);
    const stop = useRef<AbortController | null>(null);

    const explain = async (report: LastReport): Promise<void> => {
        stop.current = new AbortController();
        setExplained('');

        const pieces = agents.stream({
            prompt: 'Explain how to fix each of these findings, shortest fix first.',
            context: report.findings.map((finding) => `${finding.severity}: ${finding.text}`),
            signal: stop.current.signal
        });

        for await (const piece of pieces) {
            setExplained((current) => current + (piece.ok ? piece.value.text : `\n${piece.error.message}`));
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8, padding: 12 }}>
            {last === null ? (
                <span style={{ color: 'var(--text-muted)' }}>Check a page from the bar of a browser, or a screen from a device.</span>
            ) : (
                <>
                    <strong>{last.title}</strong>
                    {last.summary !== null && <span>{last.summary}</span>}
                    <ul style={{ listStyle: 'none', padding: 0 }}>
                        {last.findings.map((finding) => (
                            <li key={finding.rule}>
                                {finding.severity}: {finding.text}
                            </li>
                        ))}
                    </ul>
                    {last.findings.length > 0 && (
                        <div style={{ display: 'flex', gap: 8 }}>
                            <Button onClick={() => void explain(last)}>Explain the fixes</Button>
                            <Button onClick={() => stop.current?.abort()}>Stop</Button>
                        </div>
                    )}
                    <pre style={{ whiteSpace: 'pre-wrap' }}>{explained}</pre>
                </>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
                <Button onClick={() => void databasesReady().then(setLines)}>Check the databases</Button>
                <Button onClick={() => void devicesNow().then(setLines)}>Find devices</Button>
            </div>
            <ul style={{ listStyle: 'none', padding: 0 }}>
                {lines.map((line) => (
                    <li key={line}>{line}</li>
                ))}
            </ul>
        </div>
    );
}

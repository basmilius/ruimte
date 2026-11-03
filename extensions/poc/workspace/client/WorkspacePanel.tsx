import { useState } from 'react';
import { useEvent, useLocale, useStorage } from '@ruimte/extension/client';

export default function WorkspacePanel({ params }: { params: { from: string } | undefined }) {
    const { t, language, format } = useLocale();
    const [heard, setHeard] = useState<string[]>([]);
    const [perProject, setPerProject] = useStorage('opened', 0, 'project');
    const [perMachine, setPerMachine] = useStorage('opened', 0, 'machine');
    const note = (word: string) => () => setHeard((current) => [word, ...current].slice(0, 8));

    useEvent('selection.changed', note('selection'));
    useEvent('node.added', note('node added'));
    useEvent('node.removed', note('node removed'));
    useEvent('view.changed', note('view'));
    useEvent('agent.status', note('agent status'));
    useEvent('chat.turnFinished', note('turn finished'));

    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8, padding: 8 }}>
            <strong>
                {t('title')} ({language})
            </strong>
            <span>Opened from: {params?.from ?? 'the rail'}</span>
            <span>{t('heard', { count: format.formatNumber?.(heard.length) ?? heard.length })}</span>
            <button type="button" onClick={() => setPerProject(perProject + 1)}>
                This project: {perProject}
            </button>
            <button type="button" onClick={() => setPerMachine(perMachine + 1)}>
                This machine: {perMachine}
            </button>
            <ul>
                {heard.map((word, index) => (
                    <li key={`${word}${index}`}>{word}</li>
                ))}
            </ul>
        </div>
    );
}

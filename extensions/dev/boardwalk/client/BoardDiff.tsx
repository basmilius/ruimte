import type { FileInfo } from '@ruimte/extension/client';
import { cardChanges } from './board';

export default function BoardDiff({ file, diff }: { file: FileInfo; diff: string }) {
    const { added, removed } = cardChanges(diff);

    if (added.length === 0 && removed.length === 0) {
        return <div style={{ padding: 12, color: 'var(--text-muted)' }}>No card was added to or removed from {file.name}.</div>;
    }

    return (
        <ul style={{ padding: 12, listStyle: 'none' }}>
            {added.map((title) => (
                <li key={`+${title}`}>Added: {title}</li>
            ))}
            {removed.map((title) => (
                <li key={`-${title}`}>Removed: {title}</li>
            ))}
        </ul>
    );
}

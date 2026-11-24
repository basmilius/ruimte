import { useStorage } from '@ruimte/extension/client';
import { NOTES } from './checks';

export default function NotesBadge() {
    const [kept] = useStorage<string[]>(NOTES, []);

    if (kept.length === 0) {
        return null;
    }

    return <span style={{ color: 'var(--text-muted)' }}>{kept.length === 1 ? '1 note for the next report' : `${kept.length} notes for the next report`}</span>;
}

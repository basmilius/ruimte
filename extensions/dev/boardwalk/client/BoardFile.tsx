import type { FileInfo } from '@ruimte/extension/client';
import { parseBoard } from './board';
import { Columns } from './Columns';

export default function BoardFile({ file }: { file: FileInfo & { text: string | null } }) {
    if (file.text === null) {
        return <div style={{ padding: 12, color: 'var(--text-muted)' }}>{file.name} is not a board Boardwalk can read.</div>;
    }

    return <Columns board={parseBoard(file.text)} />;
}

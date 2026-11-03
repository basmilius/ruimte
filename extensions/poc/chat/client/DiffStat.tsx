import type { FileInfo } from '@ruimte/extension/client';

export default function DiffStat({ file, diff }: { file: FileInfo; diff: string }) {
    const lines = diff.split('\n');

    return (
        <div style={{ padding: 8 }}>
            {file.name}: {lines.filter((line) => line.startsWith('+')).length} added, {lines.filter((line) => line.startsWith('-')).length} removed
        </div>
    );
}

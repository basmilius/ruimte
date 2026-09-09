import { useMemo } from 'react';
import { MultiFileDiff } from '@pierre/diffs/react';
import { useTheme } from '@/state/theme';
import { DIFF_THEME } from '@/chat/ui/diff-theme';

import type { FileChange } from '@/chat/logic/tools';

/* One hunk of a file edit, highlighted in a worker. The header is ours, so the library's is off. */
export default function EditDiff({ change }: { change: FileChange }) {
    const resolved = useTheme((t) => t.resolved);
    const oldFile = useMemo(() => ({ name: change.path, contents: change.before }), [change.path, change.before]);
    const newFile = useMemo(() => ({ name: change.path, contents: change.after }), [change.path, change.after]);
    const options = useMemo(
        () => ({
            diffStyle: 'unified' as const,
            theme: DIFF_THEME,
            themeType: resolved,
            disableFileHeader: true,
            overflow: 'wrap' as const,
            hunkSeparators: 'simple' as const
        }),
        [resolved]
    );
    return (
        <div className="chat-diff select-text">
            <MultiFileDiff oldFile={oldFile} newFile={newFile} options={options} />
        </div>
    );
}

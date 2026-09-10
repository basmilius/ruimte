import { useMemo } from 'react';
import clsx from 'clsx';
import { PatchDiff } from '@pierre/diffs/react';
import type { ChatFileChange } from '@ruimte/contracts';
import { useTheme } from '@/state/theme';
import { DIFF_THEME } from '@/chat/ui/diff-theme';

/*
 * A patch the CLI reported itself (Codex writes unified diffs). The renderer needs a file header
 * to know what it is looking at, and a CLI that only sends hunks gets one from the path we know.
 * A diff without hunks at all is shown as its own lines, so nothing is ever swallowed.
 */
const asPatch = (change: ChatFileChange): string | null => {
    if (!/^@@/m.test(change.diff)) {
        return null;
    }
    if (/^\+\+\+ /m.test(change.diff)) {
        return change.diff;
    }
    const from = change.kind === 'add' ? '/dev/null' : `a/${change.path}`;
    const to = change.kind === 'delete' ? '/dev/null' : `b/${change.path}`;
    return `--- ${from}\n+++ ${to}\n${change.diff}`;
};

const lineClass = (line: string): string => {
    if (line.startsWith('+')) {
        return 'text-term-green';
    }
    if (line.startsWith('-')) {
        return 'text-term-red';
    }
    return 'text-text-muted';
};

interface UnifiedDiffProps {
    change: ChatFileChange;
    overflow?: 'wrap' | 'scroll';
    /* `split` puts the old and the new side by side; the chat always stacks. */
    diffStyle?: 'unified' | 'split';
}

export default function UnifiedDiff({ change, overflow = 'wrap', diffStyle = 'unified' }: UnifiedDiffProps) {
    const resolved = useTheme((t) => t.resolved);
    const patch = useMemo(() => asPatch(change), [change]);
    const options = useMemo(
        () => ({
            theme: DIFF_THEME,
            themeType: resolved,
            disableFileHeader: true,
            diffStyle,
            overflow,
            hunkSeparators: 'simple' as const
        }),
        [diffStyle, overflow, resolved]
    );
    if (patch === null) {
        return (
            <pre className="max-h-64 overflow-auto px-3 py-2 font-mono text-code select-text">
                {change.diff
                    .replace(/\n$/, '')
                    .split('\n')
                    .map((line, index) => (
                        <div key={index} className={clsx(lineClass(line), 'whitespace-pre-wrap')}>
                            {line}
                        </div>
                    ))}
            </pre>
        );
    }
    return (
        <div className="chat-diff select-text">
            <PatchDiff patch={patch} options={options} />
        </div>
    );
}

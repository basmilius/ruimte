import { FileTree, Icon, Pill } from '@adecore/ui';
import clsx from 'clsx';
import { ArrowDown, ArrowUp, CircleAlert, type LucideIcon } from 'lucide-react';
import type { DecorationPart } from './git-tree';

const MARKS: Partial<Record<NonNullable<DecorationPart['kind']>, LucideIcon>> = {
    ahead: ArrowUp,
    behind: ArrowDown,
    'needs-you': CircleAlert
};

export function GitTreeMarks({ parts }: { parts: readonly DecorationPart[] }) {
    return (
        <FileTree.Decoration className="font-mono text-2xs tabular-nums">
            {parts.map((part, index) => {
                const mark = part.kind === undefined ? undefined : MARKS[part.kind];
                if (mark !== undefined) {
                    return (
                        <span
                            key={index}
                            role="img"
                            aria-label={part.label}
                            style={{ color: part.color }}
                            className="flex shrink-0 items-center gap-0.5 font-sans"
                        >
                            <Icon icon={mark} size={12} />
                            {part.text}
                        </span>
                    );
                }
                if (part.kind === 'branch') {
                    return (
                        <Pill
                            key={index}
                            mono
                            size="sm"
                            /* At the end of the row it moves into the row's padding, so it stands as far from the row's
                               right edge (3 pixels) as from its top and bottom: a 20 pixel pill in a 25 pixel row. */
                            className={clsx('max-w-36', index === parts.length - 1 && 'translate-x-1.25')}
                        >
                            <span className="min-w-0 truncate">{part.text}</span>
                        </Pill>
                    );
                }
                return (
                    <span key={index} style={{ color: part.color }} className={part.kind === 'count' ? 'font-sans' : undefined}>
                        {part.text}
                    </span>
                );
            })}
        </FileTree.Decoration>
    );
}

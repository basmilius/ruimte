import { FileTree } from '@adecore/ui';
import type { DecorationPart } from './git-tree';

export function GitTreeMarks({ parts }: { parts: readonly DecorationPart[] }) {
    return (
        <FileTree.Decoration className="font-mono text-2xs tabular-nums">
            {parts.map((part, index) => (
                <span
                    key={index}
                    style={{ color: part.color }}
                    className={
                        part.kind === 'branch'
                            ? 'max-w-36 truncate rounded-sm bg-surface-raised px-1.5 py-0.5 font-sans text-2xs'
                            : part.kind === 'count'
                              ? 'font-sans'
                              : undefined
                    }
                >
                    {part.text}
                </span>
            ))}
        </FileTree.Decoration>
    );
}

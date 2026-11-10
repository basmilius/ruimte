import { CommandPalette, FileIcon } from '@adecore/ui';
import type { FsGrepMatch } from '@ruimte/contracts';
import clsx from 'clsx';
import type { PaletteRow } from '@/palette/palette-entries';
import { firstContextLine } from '@/palette/palette-grep';

export interface GrepRow extends PaletteRow {
    match: FsGrepMatch;
}

const HIGHLIGHT = 'data-highlighted:bg-surface-active [:root[data-modality=pointer]_&]:data-highlighted:bg-surface-hover';

interface LineProps {
    number: number;
    text: string;
    /* Where the hit sits in `text`; a context line has none. */
    hit?: { column: number; length: number };
}

function GrepLine({ number, text, hit }: LineProps) {
    return (
        <div className="flex gap-3 font-mono text-code leading-(--text-code--line-height)">
            <span className={clsx('w-10 shrink-0 text-right tabular-nums', hit ? 'text-text-muted' : 'text-text-faint')}>{number}</span>
            <span className={clsx('min-w-0 truncate whitespace-pre', hit ? 'text-text' : 'text-text-faint')}>
                {hit ? (
                    <>
                        {text.slice(0, hit.column)}
                        <mark className="rounded-xs bg-accent-soft text-text">{text.slice(hit.column, hit.column + hit.length)}</mark>
                        {text.slice(hit.column + hit.length)}
                    </>
                ) : (
                    text
                )}
            </span>
        </div>
    );
}

/* A hit with the lines it is read in. The whole block is the row: the line of source is a small
   target, and the context around it points at the same place in the same file. */
export function GrepItem({ row, onRun }: { row: GrepRow; onRun(row: GrepRow): void }) {
    const { match } = row;
    const start = firstContextLine(match);
    return (
        <CommandPalette.Item value={row} unstyled className={clsx('block rounded-md px-2.5 py-1 outline-none', HIGHLIGHT)} onClick={() => onRun(row)}>
            {match.before.map((text, index) => (
                <GrepLine key={`before-${index}`} number={start + index} text={text} />
            ))}
            <GrepLine number={match.line} text={match.text} hit={{ column: match.column, length: match.length }} />
            {match.after.map((text, index) => (
                <GrepLine key={`after-${index}`} number={match.line + index + 1} text={text} />
            ))}
        </CommandPalette.Item>
    );
}

/* The file a group of hits was found in. The arrows move from hit to hit, so a file with ten of them is not ten steps to the next file. */
export function GrepFileLabel({ path, count }: { path: string; count: number }) {
    return (
        <span className="flex items-center gap-1.5">
            <FileIcon path={path} size={14} />
            <span className="min-w-0 truncate">{path}</span>
            <span className="shrink-0">{count}</span>
        </span>
    );
}

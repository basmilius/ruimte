import { useEffect, useRef } from 'react';
import clsx from 'clsx';
import type { FsGrepMatch } from '@ruimte/contracts';
import { firstContextLine, groupByFile } from '@/shell/palette-grep';
import { SECTION_LABEL } from '@/ui/classes';
import { FileIcon } from '@/ui/FileIcon';

interface LineProps {
    number: number;
    text: string;
    /* Where the hit sits in `text`; a context line has none. */
    hit?: { column: number; length: number };
}

/* One line of the file as the list draws it: its number, then the source, with the hit picked out. */
function GrepLine({ number, text, hit }: LineProps) {
    return (
        <div className="flex gap-3 font-mono text-code leading-[var(--text-code--line-height)]">
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

interface BlockProps {
    match: FsGrepMatch;
    active: boolean;
    onHover(): void;
    onRun(): void;
    id: string;
}

/* A hit with the lines it is read in. The whole block is the button: the line of source is a small
   target, and the context around it points at the same place in the same file. */
function GrepBlock({ match, active, onHover, onRun, id }: BlockProps) {
    const ref = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (active) {
            ref.current?.scrollIntoView({ block: 'nearest' });
        }
    }, [active]);

    const start = firstContextLine(match);
    return (
        <button
            ref={ref}
            id={id}
            role="option"
            aria-selected={active}
            data-active={active}
            className="cursor-row block w-full rounded-md px-2.5 py-1 text-left"
            onMouseEnter={onHover}
            onClick={onRun}
        >
            {match.before.map((text, index) => (
                <GrepLine key={`before-${index}`} number={start + index} text={text} />
            ))}
            <GrepLine number={match.line} text={match.text} hit={{ column: match.column, length: match.length }} />
            {match.after.map((text, index) => (
                <GrepLine key={`after-${index}`} number={match.line + index + 1} text={text} />
            ))}
        </button>
    );
}

interface ResultsProps {
    matches: readonly FsGrepMatch[];
    /* Index into `matches`, which is the flat list the arrow keys walk. */
    active: number;
    optionId(index: number): string;
    onHover(index: number): void;
    onRun(index: number): void;
}

/* Every hit, under the file it was found in. The grouping is only a heading: the arrows move from
   hit to hit through the flat list, so a file with ten of them is not ten steps to the next file. */
export function PaletteGrepResults({ matches, active, optionId, onHover, onRun }: ResultsProps) {
    return (
        <>
            {groupByFile(matches).map((group) => (
                <div key={group.path}>
                    <div className={`${SECTION_LABEL} flex items-center gap-1.5 px-2.5 pt-1.5 pb-1`}>
                        <FileIcon path={group.path} size={14} />
                        <span className="min-w-0 truncate normal-case">{group.path}</span>
                        <span className="text-text-faint">{group.matches.length}</span>
                    </div>
                    {group.matches.map((match, index) => {
                        const at = group.offset + index;
                        return (
                            <GrepBlock
                                key={`${match.path}:${match.line}:${match.column}`}
                                id={optionId(at)}
                                match={match}
                                active={at === active}
                                onHover={() => onHover(at)}
                                onRun={() => onRun(at)}
                            />
                        );
                    })}
                </div>
            ))}
        </>
    );
}

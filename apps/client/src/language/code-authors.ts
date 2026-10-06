import i18next from 'i18next';
import { diffLines, splitLines } from '@adecore/merge';
import type { GitBlameCommit, GitBlameResult } from '@ruimte/contracts';
import { formatNumber } from '@adecore/ui/format';

/* What a line of the text in the editor is: the index of the commit that wrote it, or this for a line no commit holds yet. */
export const UNCOMMITTED = -1;

/*
 * The commit of every line of the text in the editor. Blame was run for the text on disk, so a line
 * the editor still has from there keeps its commit and a line that was typed since, replaced or
 * pasted has none, which reads as uncommitted. Null when the blame is not of that text.
 */
export function mapBlame(blame: GitBlameResult, base: string, current: readonly string[]): Int32Array | null {
    const baseLines = splitLines(base);
    if (blame.lines.length !== baseLines.length) {
        return null;
    }
    const mapped = new Int32Array(current.length).fill(UNCOMMITTED);
    let basePosition = 0;
    let position = 0;
    const carry = (until: number): void => {
        for (; position < until; position++, basePosition++) {
            mapped[position] = blame.lines[basePosition]!;
        }
    };
    for (const change of diffLines(baseLines, current)) {
        carry(change.otherStart);
        position = change.otherEnd;
        basePosition = change.baseEnd;
    }
    carry(current.length);
    return mapped;
}

export interface CodeAuthor {
    readonly name: string;
    readonly email: string;
    /* The lines of the range this author wrote, blank ones left out. */
    readonly lines: number;
}

export interface CodeAuthorship {
    /* Most lines first; one who wrote as many as another comes first by name. */
    readonly authors: readonly CodeAuthor[];
    /* Lines of the range no commit holds yet, blank ones left out. */
    readonly uncommittedLines: number;
    /* Whether any line of the range, a blank one too, is changed since the commit it came from. */
    readonly modified: boolean;
    /* The newest commit that wrote a line of the range. */
    readonly latest: GitBlameCommit | null;
}

/* A person's name as git has it, with runs of space made one. */
export function shortName(name: string): string {
    return name.replace(/\s+/g, ' ').trim();
}

/*
 * Who wrote the lines `from` through `to`. Blank lines count for no one and a line that is not
 * committed for no author, so a method that is only edited keeps its author and says it was edited.
 */
export function authorshipOf(commits: readonly GitBlameCommit[], mapped: Int32Array, lines: readonly string[], from: number, to: number): CodeAuthorship {
    const byName = new Map<string, { name: string; email: string; lines: number }>();
    let uncommittedLines = 0;
    let modified = false;
    let latest: GitBlameCommit | null = null;
    for (let line = from; line <= to && line < mapped.length; line++) {
        const index = mapped[line]!;
        if (index === UNCOMMITTED) {
            modified = true;
        }
        if (lines[line]!.trim() === '') {
            continue;
        }
        if (index === UNCOMMITTED) {
            uncommittedLines++;
            continue;
        }
        const commit = commits[index]!;
        const name = shortName(commit.author);
        if (name === '') {
            continue;
        }
        const author = byName.get(name) ?? { name, email: commit.email, lines: 0 };
        author.lines++;
        byName.set(name, author);
        if (latest === null || commit.at > latest.at) {
            latest = commit;
        }
    }
    const authors = [...byName.values()].sort((left, right) => right.lines - left.lines || (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
    return { authors, uncommittedLines, modified, latest };
}

/* The row's words: the author with most lines, how many others wrote some, and a star when the range is edited since the commit. */
export function authorsText(authorship: CodeAuthorship): string {
    const main = authorship.authors[0];
    if (main === undefined) {
        return i18next.t('panels:language.codeVision.newCode');
    }
    const others = authorship.authors.length - 1;
    return `${main.name}${others > 0 ? ` +${formatNumber(others)}` : ''}${authorship.modified ? ' *' : ''}`;
}

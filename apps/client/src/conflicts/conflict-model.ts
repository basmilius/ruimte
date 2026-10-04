import type { GitConflictKind, GitConflictResult, GitResolveBlock } from '@ruimte/contracts';
import { draftOf, fingerprint, joinLines, shapeOf, splitBlocks, splitLines, type MergeBlock, type MergeSpan, type TextShape } from '@ruimte/merge';
import type { ConflictDraft, LiveSpan } from '@/conflicts/editor';

/* One unmerged file as the overlay works on it: the three versions split into stretches, the merged
   file to start from, and the shape the result is written back in. */
export interface ConflictFile {
    path: string;
    kind: GitConflictKind;
    blocks: MergeBlock[];
    /* Where every block sits in `text`, by line, `to` exclusive. */
    spans: MergeSpan[];
    text: string;
    shape: TextShape;
    /* What stood on disk when this was read; the resolution is written over exactly that. */
    hash: string;
    /* Set when there is nothing to merge line by line: the file is a choice between whole sides. */
    whole: boolean;
}

/* The three versions git handed back, as the file the overlay draws. */
export function fileOf(answer: GitConflictResult): ConflictFile {
    const whole = answer.kind !== 'text' || answer.ours === null || answer.theirs === null;
    const blocks = whole ? [] : splitBlocks(splitLines(answer.base ?? ''), splitLines(answer.ours ?? ''), splitLines(answer.theirs ?? ''));
    const draft = draftOf(blocks);
    return {
        path: answer.path,
        kind: answer.kind,
        blocks,
        spans: draft.spans,
        text: draft.lines.join('\n'),
        // Our side decides the shape: the result goes on the branch the checkout is on.
        shape: shapeOf(answer.ours ?? answer.theirs ?? answer.base ?? ''),
        hash: answer.hash,
        whole
    };
}

/* The merged file as it goes to disk: the editor works in plain newlines, the file keeps its own. */
export function contentOf(file: ConflictFile, text: string): string {
    return joinLines(text === '' ? [] : text.split('\n'), file.shape);
}

/* Every conflict of the file, settled or not, which is what the arrows walk through. */
export function conflictIndexes(file: ConflictFile): number[] {
    return file.blocks.flatMap((block, index) => (block.kind === 'conflict' ? [index] : []));
}

/* The conflict after this one, wrapping around at the end so the arrows never run out. */
export function nextConflict(indexes: readonly number[], current: number | null, step: 1 | -1): number | null {
    if (indexes.length === 0) {
        return null;
    }
    if (current === null) {
        return (step === 1 ? indexes[0] : indexes[indexes.length - 1]) ?? null;
    }
    const at = indexes.indexOf(current);
    if (at < 0) {
        return (step === 1 ? indexes.find((index) => index > current) : [...indexes].reverse().find((index) => index < current)) ?? indexes[0] ?? null;
    }
    return indexes[(at + step + indexes.length) % indexes.length] ?? null;
}

/* Where every line starts, with the end of the text behind the last one. */
function lineOffsets(lines: readonly string[]): number[] {
    const offsets = [0];
    for (const line of lines) {
        offsets.push(offsets[offsets.length - 1]! + line.length + 1);
    }
    // The last line carries no break, so the text ends one character earlier than the walk counted.
    offsets[offsets.length - 1] = Math.max(0, offsets[offsets.length - 1]! - 1);
    return offsets;
}

/*
 * A file with some of its conflicts answered, without an editor. This is what an answer lands in
 * for every file but the one on screen: the same draft the editor would have built, with the
 * answered stretches in place and settled.
 */
export function draftWith(file: ConflictFile, answered: ReadonlyMap<number, readonly string[]>): ConflictDraft {
    const draft = draftOf(file.blocks, answered);
    const offsets = lineOffsets(draft.lines);
    return {
        text: draft.lines.join('\n'),
        spans: draft.spans.map((span) => ({
            block: span.block,
            kind: span.kind,
            from: offsets[span.from] ?? 0,
            to: offsets[span.to] ?? 0,
            settled: span.kind !== 'conflict' || answered.has(span.block)
        }))
    };
}

/* What `replacementOf` reads of a document, which a CodeMirror `Text` and a wrapped string both have. */
interface DraftText {
    readonly length: number;
    sliceString(from: number, to: number): string;
}

/* The edit that puts `lines` in place of a span of the merged file. */
export function replacementOf(
    doc: DraftText,
    span: { readonly from: number; readonly to: number },
    lines: readonly string[]
): { from: number; to: number; insert: string } {
    const ends = span.to >= doc.length;
    if (lines.length === 0) {
        // The last line carries no break of its own, so emptying it takes the one before it along.
        const trailing = ends && span.from < span.to && span.from > 0 && doc.sliceString(span.from - 1, span.from) === '\n';
        return { from: trailing ? span.from - 1 : span.from, to: span.to, insert: '' };
    }
    // A stretch that holds no line at the end of the file needs the break that would have preceded it.
    const lead = span.from === span.to && span.from === doc.length && doc.length > 0 ? '\n' : '';
    return { from: span.from, to: span.to, insert: `${lead}${lines.join('\n')}${ends ? '' : '\n'}` };
}

/*
 * Answers put into a file that is not on screen, the way the editor would put them in: only a
 * conflict still open takes one, so what a person already wrote in the file stays as they left it.
 * A file never opened starts from its merged draft.
 */
export function answerInto(draft: ConflictDraft | undefined, file: ConflictFile, answered: ReadonlyMap<number, readonly string[]>): ConflictDraft {
    let { text, spans } = draft ?? draftWith(file, new Map());
    for (const [block, lines] of answered) {
        const span = spans.find((candidate) => candidate.block === block);
        if (span === undefined || span.kind !== 'conflict' || span.settled) {
            continue;
        }
        const source = text;
        const change = replacementOf({ length: source.length, sliceString: (from, to) => source.slice(from, to) }, span, lines);
        const shift = change.insert.length - (change.to - change.from);
        text = `${source.slice(0, change.from)}${change.insert}${source.slice(change.to)}`;
        spans = spans.map((other) => {
            if (other.block === block) {
                return { ...other, from: change.from, to: change.from + change.insert.length, settled: true };
            }
            if (other.block > block) {
                return { ...other, from: other.from + shift, to: other.to + shift };
            }
            // Emptying the last stretch takes the break before it, which the stretch before it ended on.
            return { ...other, from: Math.min(other.from, change.from), to: Math.min(other.to, change.from) };
        });
    }
    return { text, spans };
}

/* The conflicts of a draft that still need a person. */
export function openInDraft(draft: ConflictDraft): number[] {
    return draft.spans.filter((span) => span.kind === 'conflict' && !span.settled).map((span) => span.block);
}

/*
 * The proposals that still fit the file in front of us. A fingerprint that does not match is an
 * answer written for another version of the stretch, which is a proposal to drop rather than to
 * apply somewhere it was never meant.
 */
export function usableBlocks(file: ConflictFile, answers: readonly GitResolveBlock[]): { index: number; lines: string[] }[] {
    return answers
        .filter((answer) => {
            const block = file.blocks[answer.index];
            return block !== undefined && block.kind === 'conflict' && fingerprint(block) === answer.fingerprint;
        })
        .map((answer) => ({ index: answer.index, lines: answer.lines }));
}

/* What a person made of one stretch of a draft, as lines. */
function spanLines(text: string, span: LiveSpan): string[] {
    let slice = text.slice(span.from, span.to);
    // An answer put into an empty stretch at the end of the file carries the break before it.
    if (span.from > 0 && text[span.from - 1] !== '\n' && slice.startsWith('\n')) {
        slice = slice.slice(1);
    }
    if (span.to < text.length && slice.endsWith('\n')) {
        slice = slice.slice(0, -1);
    }
    return slice === '' ? [] : slice.split('\n');
}

function sameBlocks(before: ConflictFile, after: ConflictFile): boolean {
    return (
        before.blocks.length === after.blocks.length &&
        before.blocks.every((block, index) => block.kind === after.blocks[index]!.kind && fingerprint(block) === fingerprint(after.blocks[index]!))
    );
}

/*
 * The work on a file carried over to the same file read again. While git holds the same versions,
 * which a save in an editor or an agent's write leaves alone, the draft stays whole; otherwise only
 * an answered conflict whose stretch is still the same one comes along.
 */
export function carryDraft(before: ConflictFile, after: ConflictFile, draft: ConflictDraft): ConflictDraft {
    if (sameBlocks(before, after)) {
        return draft;
    }
    const free = new Map(conflictIndexes(after).map((index) => [index, fingerprint(after.blocks[index]!)] as const));
    const answered = new Map<number, string[]>();
    for (const span of draft.spans) {
        const block = before.blocks[span.block];
        if (span.kind !== 'conflict' || !span.settled || block === undefined) {
            continue;
        }
        const print = fingerprint(block);
        const match = [...free].find(([, candidate]) => candidate === print)?.[0];
        if (match !== undefined) {
            answered.set(match, spanLines(draft.text, span));
            free.delete(match);
        }
    }
    return answerInto(undefined, after, answered);
}

/* The overlay's work per file: what was read of it and what a person made of it. */
export interface ConflictCache {
    files: Map<string, ConflictFile>;
    drafts: Map<string, ConflictDraft>;
}

/* What writing a file asks of the machine. */
export interface ConflictWriter {
    resolve(path: string, content: string, hash: string): Promise<unknown>;
    read(path: string): Promise<GitConflictResult>;
}

/* A file read again, so the next write goes over what stands on disk now. The same versions keep the file as it was, editor and all. */
export async function rereadConflict(cache: ConflictCache, path: string, read: ConflictWriter['read']): Promise<void> {
    const after = fileOf(await read(path));
    const before = cache.files.get(path);
    if (before === undefined) {
        cache.files.set(path, after);
        return;
    }
    cache.files.set(path, sameBlocks(before, after) ? { ...before, hash: after.hash } : after);
    const draft = cache.drafts.get(path);
    if (draft !== undefined) {
        cache.drafts.set(path, carryDraft(before, after, draft));
    }
}

/*
 * One file written as it stands, over the version it was read at. A file that moved on disk since
 * refuses, and is read again before the refusal goes on, so the next try is not refused for the
 * same reason; what a person made of it stays.
 */
export async function writeConflict(cache: ConflictCache, path: string, writer: ConflictWriter): Promise<void> {
    const target = cache.files.get(path);
    const draft = cache.drafts.get(path);
    if (target === undefined || draft === undefined) {
        return;
    }
    try {
        await writer.resolve(path, contentOf(target, draft.text), target.hash);
    } catch (error: unknown) {
        await rereadConflict(cache, path, writer.read).catch(() => undefined);
        throw error;
    }
    cache.files.delete(path);
    cache.drafts.delete(path);
}

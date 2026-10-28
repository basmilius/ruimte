import { lstat, mkdir, readdir, readFile, rename, rm, rmdir } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { designFolderOf, designPlaces, isSharedDesign, type DesignPlace, type ProjectView } from '@ruimte/contracts';
import { writeAtomic } from '@adecore/agents';
import { isRecord } from '../is-record.ts';

/*
 * The moves this daemon started and has not settled yet, under `private` so git never sees it. Only a
 * folder named here is ever taken from the other side, so a teammate's folder that happens to sit there
 * stays theirs.
 */
const JOURNAL = join('.ruimte', 'private', 'design-moves.json');

async function exists(path: string): Promise<boolean> {
    return (await lstat(path).catch(() => null)) !== null;
}

/* A document as far as where its designs go: its views, and which of them are shared. */
export interface DesignSides {
    views: readonly ProjectView[];
    shared: readonly string[];
}

/* A design whose folder goes from one side to the other, both relative to the project folder. */
export interface DesignMove {
    id: string;
    name: string;
    from: string;
    to: string;
}

/* Whether a chat of the design may still write to the folder it was told when its turn began. */
export type DesignAtWork = (design: DesignPlace) => boolean;

interface JournaledMove {
    id: string;
    from: string;
    to: string;
}

const NOTHING_AT_WORK: DesignAtWork = () => false;

function isJournaledMove(value: unknown): value is JournaledMove {
    return isRecord(value) && typeof value.id === 'string' && typeof value.from === 'string' && typeof value.to === 'string';
}

/* An unreadable journal names no move, so nothing is taken from the other side. */
async function readJournal(projectFolder: string): Promise<JournaledMove[]> {
    const text = await readFile(join(projectFolder, JOURNAL), 'utf8').catch(() => null);

    if (text === null) {
        return [];
    }

    try {
        const parsed: unknown = JSON.parse(text);

        return isRecord(parsed) && Array.isArray(parsed.moves) ? parsed.moves.filter(isJournaledMove) : [];
    } catch {
        return [];
    }
}

async function writeJournal(projectFolder: string, moves: readonly JournaledMove[]): Promise<void> {
    const path = join(projectFolder, JOURNAL);

    if (moves.length === 0) {
        await rm(path, { force: true });
        return;
    }

    await mkdir(dirname(path), { recursive: true });
    await writeAtomic(path, `${JSON.stringify({ moves }, null, 2)}\n`, 0o644);
}

/* The designs whose folder lies under `.ruimte` and so follows their side; a folder of the project a design named itself never moves. */
function movableOf({ views }: DesignSides): DesignPlace[] {
    return designPlaces(views).filter((design) => !design.path.includes('/'));
}

/* The designs of `after` whose folder is on another side than in `before`. */
function movesOf(before: DesignSides, after: DesignSides): DesignMove[] {
    const was = new Map(movableOf(before).map((design) => [design.id, designFolderOf(design, isSharedDesign(design, before.shared))]));

    return movableOf(after).flatMap((design) => {
        const from = was.get(design.id);
        const to = designFolderOf(design, isSharedDesign(design, after.shared));

        return from === undefined || from === to ? [] : [{ id: design.id, name: design.name, from, to }];
    });
}

/*
 * The designs a write would move onto a folder that is already there, such as one a teammate shared
 * under the same name. Asked before the write, so two designs never end up on one folder.
 */
export async function takenDesignFolders(projectFolder: string, before: DesignSides, after: DesignSides): Promise<DesignMove[]> {
    const taken: DesignMove[] = [];

    for (const move of movesOf(before, after)) {
        if (await exists(join(projectFolder, move.to))) {
            taken.push(move);
        }
    }

    return taken;
}

/*
 * The folders of the designs a write moved between the two files, moved after it: from
 * `.ruimte/private/designs/` into `.ruimte/designs/` when a design is shared, or its canvas is, or it
 * goes between a shared canvas and a view of its own, and back the other way. One rename per folder,
 * so a folder is on one side or the other and never half. A write onto a folder that is already there
 * is refused before it (`takenDesignFolders`); one that appeared in between is someone's work and stays,
 * and so does the one that would replace it. Each move is journaled before its rename, and stays
 * journaled while a chat of the design is at work, since its CLI writes to the old folder until its
 * next turn (`settleDesignFolders`). Answers the designs it could not move.
 */
export async function moveDesignFolders(projectFolder: string, before: DesignSides, after: DesignSides, atWork = NOTHING_AT_WORK): Promise<string[]> {
    const designs = new Map(movableOf(after).map((design) => [design.id, design]));
    const stuck: string[] = [];
    let journal = await readJournal(projectFolder);

    for (const move of movesOf(before, after)) {
        const from = join(projectFolder, move.from);
        const to = join(projectFolder, move.to);

        if (!(await exists(from))) {
            continue;
        }

        if (await exists(to)) {
            stuck.push(move.id);
            continue;
        }

        const others = journal.filter((entry) => entry.id !== move.id);
        journal = [...others, { id: move.id, from: move.from, to: move.to }];
        await writeJournal(projectFolder, journal);
        await mkdir(dirname(to), { recursive: true });
        await rename(from, to);

        const design = designs.get(move.id);

        if (design === undefined || !atWork(design)) {
            journal = others;
            await writeJournal(projectFolder, journal);
        }
    }

    return stuck;
}

/* `Onboarding.html` as `Onboarding (left behind).html`, numbered once that is taken too. */
async function leftBehindName(folder: string, name: string): Promise<string> {
    const extension = extname(name);
    const stem = name.slice(0, name.length - extension.length);

    for (let i = 1; ; i++) {
        const candidate = join(folder, `${stem} (left behind${i === 1 ? '' : ` ${i}`})${extension}`);

        if (!(await exists(candidate))) {
            return candidate;
        }
    }
}

async function sameBytes(left: string, right: string): Promise<boolean> {
    const [leftStat, rightStat] = await Promise.all([lstat(left), lstat(right)]);

    if (leftStat.size !== rightStat.size) {
        return false;
    }

    const [leftBytes, rightBytes] = await Promise.all([readFile(left), readFile(right)]);

    return leftBytes.equals(rightBytes);
}

/*
 * Moves every entry of `from` that `to` lacks into it. On a clash `to` keeps its own and the one from
 * `from` sits beside it as a copy that was left behind, unless both hold the same bytes; nothing is
 * thrown away. `from` goes once it is empty.
 */
async function mergeFolder(from: string, to: string): Promise<void> {
    if (!(await exists(to))) {
        await mkdir(dirname(to), { recursive: true });
        await rename(from, to);
        return;
    }

    for (const entry of await readdir(from, { withFileTypes: true })) {
        const source = join(from, entry.name);
        const target = join(to, entry.name);
        const present = await lstat(target).catch(() => null);

        if (present === null) {
            await rename(source, target);
        } else if (entry.isDirectory() && present.isDirectory()) {
            await mergeFolder(source, target);
        } else if (entry.isFile() && present.isFile() && (await sameBytes(source, target))) {
            await rm(source);
        } else {
            await rename(source, await leftBehindName(to, entry.name));
        }
    }

    await rmdir(from).catch(() => undefined);
}

/*
 * Settles the moves this daemon journaled: a folder on the side its design left goes into the one the
 * document puts it on. That is the whole folder after a crash between the write and the rename, or what
 * a chat that was in a turn wrote to the old folder after the move, merged into the new one. A move
 * stays journaled while `atWork` says a chat of its design may still write there, and goes once it does
 * not or its design is gone. A folder no move of this daemon left is never taken, however it got there.
 * Answers the designs it took a folder in for.
 */
export async function settleDesignFolders(projectFolder: string, sides: DesignSides, atWork = NOTHING_AT_WORK): Promise<string[]> {
    const journal = await readJournal(projectFolder);

    if (journal.length === 0) {
        return [];
    }

    const designs = new Map(movableOf(sides).map((design) => [design.id, design]));
    const claimed = new Set(designPlaces(sides.views).map((design) => designFolderOf(design, isSharedDesign(design, sides.shared))));
    const kept: JournaledMove[] = [];
    const settled: string[] = [];

    for (const move of journal) {
        const design = designs.get(move.id);

        if (design === undefined) {
            continue;
        }

        const shared = isSharedDesign(design, sides.shared);
        const expected = designFolderOf(design, shared);
        const left = designFolderOf(design, !shared);

        // Only the two sides of this design: the journal is a file anyone on the machine could edit.
        if (!((move.from === left && move.to === expected) || (move.from === expected && move.to === left))) {
            continue;
        }

        if (!claimed.has(left) && (await exists(join(projectFolder, left)))) {
            await mergeFolder(join(projectFolder, left), join(projectFolder, expected));
            settled.push(design.id);
        }

        if (atWork(design)) {
            kept.push(move);
        }
    }

    if (kept.length !== journal.length) {
        await writeJournal(projectFolder, kept);
    }

    return settled;
}

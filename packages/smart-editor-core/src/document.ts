import { CloserTracker } from './closer-tracker.ts';
import { planBlockComment, planLineComments } from './comments.ts';
import { planEnter } from './enter.ts';
import { planAutoIndent, planJoinLines, planToggleCase } from './line-commands.ts';
import { mapOffset } from './offsets.ts';
import { planPaste } from './paste.ts';
import type { EnterOptions, EnterPlan } from './enter.ts';
import type { EditPlan, EditSource } from './edit-source.ts';
import { isPlainText, vueRegionAt } from './languages.ts';
import { blockFolds } from './block-folds.ts';
import { applyFoldHints, markFileHeader } from './fold-roles.ts';
import { lexicalFolds } from './lexical-folds.ts';
import { isQuote, replacesComparison, surround, swapQuotes } from './typing-handlers.ts';
import { scanBrackets } from './brackets.ts';
import type { BracketIndex } from './brackets.ts';
import { hasSmartSemicolon } from './lexical.ts';
import { clampInteger, TextRope } from './rope.ts';
import type { DocumentLine } from './rope.ts';
import { findMatches, replacementText, splitsSurrogate } from './search.ts';
import type { FindMatch, FindNextOptions, FindOptions } from './search.ts';
import { dedupeFoldingRanges, deriveFoldingRanges, indentationColumn, scanStructure, tabWidth } from './structure.ts';
import type { FoldingOptions, FoldingRange, StructureRange } from './structure.ts';
import type {
    CommandOptions,
    ContentEdit,
    Disposable,
    DocumentChange,
    EditOptions,
    EditorCommand,
    EditorSnapshot,
    Position,
    Selection,
    TextEdit
} from './types.ts';
import { TypingContexts } from './typing-context.ts';
import type { TypingContext } from './typing-context.ts';
import { isHumpBoundary, isWordBoundary } from './words.ts';

export type { DocumentLine, FindMatch, FindNextOptions, FindOptions, FoldingOptions, FoldingRange };

/* A stretch of the text by offsets. */
export interface OffsetRange {
    readonly from: number;
    readonly to: number;
}

export interface DocumentEditOptions extends EditOptions {
    /* The edit is refused, with nothing changed, unless the document is still at this revision. */
    expectedRevision?: number;
}

export interface TypeTextOptions extends CommandOptions {
    /* Defaults to `typing`, which makes consecutive calls one undo step. */
    historyGroup?: string;
    expectedRevision?: number;
}

export interface ReplaceOptions extends DocumentEditOptions {
    /* Insert the replacement as it is, without expanding `$1` and the like. */
    literal?: boolean;
    /* The replacement takes the case of the text it replaces. */
    preserveCase?: boolean;
}

export interface ReplaceAllOptions extends FindOptions, ReplaceOptions {}

interface State {
    rope: TextRope;
    selections: Selection[];
}

interface HistoryEntry {
    before: State;
    after: State;
    group?: string;
    /* One list per transaction folded into this step, in the coordinates of the text before each. */
    changes: DocumentChange[][];
}

/* An edit and where the caret that asked for it ends up, relative to the start of what it inserts. */
interface SelectionEdit extends TextEdit {
    anchor: number;
    head: number;
    /* The key was swallowed: nothing is inserted, the caret only moves. */
    skip?: boolean;
    /* The `)` and `]` a smart semicolon just stepped over, which the next keystroke may still type over. */
    completedClosers?: string;
    consumed?: boolean;
    /* An opener and the closer the editor added with it, with the caret between them. */
    paired?: boolean;
}

interface SelectionTransaction {
    edits: TextEdit[];
    selections: Selection[];
}

interface LineBlock {
    first: number;
    last: number;
}

interface TypingInput {
    text: string;
    language: string;
    /* Whether a typed bracket or quote pairs, types over its closer and goes in pairs. */
    brackets: boolean;
    quotes: boolean;
    surround: boolean;
    smartSemicolon: boolean;
    /* A closing bracket typed on a line of its own goes back to the indentation of its opener. */
    dedent: boolean;
}

/* The row of the screen an offset is on: where it starts and where it ends, which is where the next one starts when the line wraps. */
export type VisualLineOf = (offset: number) => { start: number; end: number };

/* A caret made by cloning another, with the columns it keeps wherever the lines it crosses are short. */
interface CaretClone {
    selection: Selection;
    caretColumn: number;
    startColumn: number;
    endColumn: number;
}

/* Where a word move may stop: at the start of words, at their end, or both. */
type CaretStopAt = 'start' | 'end' | 'both';

interface CaretStops {
    word: CaretStopAt;
    /* Where the move stops at a line break: the start of the next line, the end of the line, or both, which is the end first. */
    line: CaretStopAt;
}

/* The platform's defaults: forward to a word's end and then the start of the next line, backward to a word's start and then the end of the line above. Deleting stops at every edge of a word and at both ends of a line. */
const MOVE_FORWARD: CaretStops = { word: 'end', line: 'start' };
const MOVE_BACKWARD: CaretStops = { word: 'start', line: 'end' };
const DELETE_FORWARD: CaretStops = { word: 'both', line: 'both' };
const DELETE_BACKWARD: CaretStops = { word: 'start', line: 'both' };

const historyLimit = 200;
const bracketScanLimit = 2_000_000;
/* Typing a bracket reads the document once to see whether it already has a closer, so a very large one is not read. */
const matchScanLimit = 400_000;
const pairs: Readonly<Record<string, string>> = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' };
const identifier = /[\p{L}\p{N}\p{M}\p{Pc}$]/u;
const wordCommand = /^(select|delete)?(word|camel)(Left|Right)$/i;
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function rangeOf(selection: Selection): { from: number; to: number } {
    return { from: Math.min(selection.anchor, selection.head), to: Math.max(selection.anchor, selection.head) };
}

function sameSelections(left: readonly Selection[], right: readonly Selection[]): boolean {
    return left.length === right.length && left.every((selection, index) => selection.anchor === right[index]!.anchor && selection.head === right[index]!.head);
}

function indentLength(text: string): number {
    return text.match(/^[\t ]*/)?.[0].length ?? 0;
}

function trailingBlankLength(text: string): number {
    return text.match(/[\t ]*$/)?.[0].length ?? 0;
}

function changesText(rope: TextRope, edit: TextEdit): boolean {
    return edit.text.length !== edit.to - edit.from || rope.slice(edit.from, edit.to) !== edit.text;
}

/* Merges the carets' edits into one simultaneous batch and works out where each caret lands in the result. */
function selectionTransaction(plans: readonly SelectionEdit[]): SelectionTransaction {
    const edits: TextEdit[] = [];
    for (const plan of plans.filter((candidate) => !candidate.skip).sort((left, right) => left.from - right.from || left.to - right.to)) {
        const previous = edits.at(-1);
        if (previous?.from !== plan.from || previous.to !== plan.to || previous.text !== plan.text) {
            edits.push(plan);
        }
    }
    const selections = plans.map((plan) => {
        const delta = edits.filter((edit) => edit.from < plan.from).reduce((sum, edit) => sum + edit.text.length - (edit.to - edit.from), 0);
        return { anchor: plan.from + delta + plan.anchor, head: plan.from + delta + plan.head };
    });
    return { edits, selections };
}

function splitsCluster(rope: TextRope, offset: number): boolean {
    return splitsSurrogate(rope, offset) || (rope.charAt(offset - 1) === '\r' && rope.charAt(offset) === '\n');
}

/* Clamps to the document and moves back off the middle of a surrogate pair or a CRLF. */
function offsetIn(rope: TextRope, value: number): number {
    const offset = clampInteger(value, rope.length);
    return splitsCluster(rope, offset) ? offset - 1 : offset;
}

function step(rope: TextRope, offset: number, direction: -1 | 1): number {
    const next = clampInteger(offset + direction, rope.length);
    return splitsCluster(rope, next) ? next + direction : next;
}

function isAsciiOrEmpty(character: string): boolean {
    return character === '' || character.charCodeAt(0) <= 0x7f;
}

/* One backspace or delete: a code point or a CRLF, or a whole grapheme once the text is not plain ASCII. */
function deletionStep(rope: TextRope, offset: number, direction: -1 | 1): number {
    const scalar = step(rope, offset, direction);
    const current = rope.charAt(direction < 0 ? offset - 1 : offset);
    const following = rope.charAt(direction < 0 ? offset : offset + 1);
    if (current === '\n' || current === '\r') {
        return scalar;
    }
    if (isAsciiOrEmpty(current) && isAsciiOrEmpty(following)) {
        return scalar;
    }
    const line = rope.getLine(rope.lineAt(offset));
    let previous = line.start;
    for (const segment of graphemes.segment(line.text)) {
        const at = line.start + segment.index;
        if (direction < 0 && at >= offset) {
            return previous;
        }
        if (direction > 0 && at > offset) {
            return at;
        }
        previous = at;
    }
    return direction < 0 ? previous : line.end;
}

/*
 * Clamps every selection and merges the ones that overlap or touch, so the result is disjoint. The
 * last one stays the primary caret, and a merge that takes it in keeps it last.
 */
function normalizeSelections(rope: TextRope, selections: readonly Selection[]): Selection[] {
    const input = selections.length > 0 ? selections : [{ anchor: 0, head: 0 }];
    const result: { selection: Selection; primary: boolean }[] = [];
    for (const [position, raw] of input.entries()) {
        let selection = { anchor: offsetIn(rope, raw.anchor), head: offsetIn(rope, raw.head) };
        let primary = position === input.length - 1;
        let { from, to } = rangeOf(selection);
        for (let index = result.length - 1; index >= 0; index--) {
            const other = rangeOf(result[index]!.selection);
            if (from <= other.to && to >= other.from) {
                from = Math.min(from, other.from);
                to = Math.max(to, other.to);
                primary ||= result[index]!.primary;
                result.splice(index, 1);
                selection = selection.anchor > selection.head ? { anchor: to, head: from } : { anchor: from, head: to };
            }
        }
        result.push({ selection, primary });
    }
    const primary = result.findIndex((entry) => entry.primary);
    if (primary !== result.length - 1) {
        result.push(...result.splice(primary, 1));
    }
    return result.map((entry) => entry.selection);
}

function inverseChanges(changes: readonly DocumentChange[]): DocumentChange[] {
    let delta = 0;
    return changes.map((change) => {
        const from = change.from + delta;
        delta += change.insertedLength - (change.to - change.from);
        return { from, to: from + change.insertedLength, insertedLength: change.to - change.from };
    });
}

/* Runs of consecutive line numbers, from a sorted list. */
function blocks(indices: readonly number[]): LineBlock[] {
    const result: LineBlock[] = [];
    for (const index of indices) {
        const previous = result.at(-1);
        if (previous && previous.last + 1 === index) {
            previous.last = index;
        } else {
            result.push({ first: index, last: index });
        }
    }
    return result;
}

/* How much of the whitespace before a caret to keep so that it ends on the previous tab stop. */
function indentStopLength(prefix: string, tabSize: number): number {
    const column = indentationColumn(prefix, tabSize);
    const target = Math.floor((column - 1) / tabSize) * tabSize;
    let width = 0;
    let length = 0;
    while (length < prefix.length) {
        const next = width + (prefix[length] === '\t' ? tabSize - (width % tabSize) : 1);
        if (next > target) {
            break;
        }
        width = next;
        length++;
    }
    return length;
}

function positionIn(rope: TextRope, offset: number): Position {
    const line = rope.lineAt(offset);
    return { line, column: Math.min(offset, rope.lineBounds(line).end) - rope.lineBounds(line).start };
}

/* Simultaneous edits of `rope` as a sequence, last to first, so each edit's position in `rope` is also its position once the ones after it are applied. */
function editsOf(rope: TextRope, edits: readonly TextEdit[]): ContentEdit[] {
    return [...edits].reverse().map((edit) => ({ start: positionIn(rope, edit.from), end: positionIn(rope, edit.to), text: edit.text }));
}

/*
 * What a history step did, as the one stretch that holds every change. The intermediate texts of its
 * transactions are gone, so the stretch runs from the first changed offset to the last, counted from
 * either end, and is a little more than the change when two of them are far apart.
 */
function stretchEdits(before: TextRope, after: TextRope, transactions: readonly (readonly DocumentChange[])[]): ContentEdit[] {
    let length = before.length;
    let prefix = Number.POSITIVE_INFINITY;
    let suffix = Number.POSITIVE_INFINITY;
    for (const changes of transactions) {
        let delta = 0;
        for (const change of changes) {
            prefix = Math.min(prefix, change.from);
            suffix = Math.min(suffix, length - change.to);
            delta += change.insertedLength - (change.to - change.from);
        }
        length += delta;
    }
    if (!Number.isFinite(prefix)) {
        return [];
    }
    const kept = Math.min(Math.max(0, suffix), before.length - prefix, after.length - prefix);
    const oldEnd = before.length - kept;
    const newEnd = after.length - kept;
    if (oldEnd === prefix && newEnd === prefix) {
        return [];
    }
    return [{ start: positionIn(before, prefix), end: positionIn(before, oldEnd), text: after.slice(prefix, newEnd) }];
}

/*
 * Text with a selection, undo history and the editing commands of a code editor, and no idea how it
 * is drawn. Offsets are UTF-16 code units, lines and columns zero-based. The text is a persistent
 * rope, so history shares what an edit left alone.
 */
export class DocumentModel {
    private rope: TextRope;
    private selections: Selection[] = [{ anchor: 0, head: 0 }];
    private revision = 0;
    private undoStack: HistoryEntry[] = [];
    private redoStack: HistoryEntry[] = [];
    private listeners = new Set<(snapshot: EditorSnapshot) => void>();
    private groupOpen = false;
    private textCache: { text?: string };
    private structureCache?: StructureRange[];
    private selectionHistory: Selection[][] = [];
    private typingContexts = new TypingContexts((line) => this.getLine(line));
    private statementClosers = new Map<number, { text: string; language: string }>();
    private cloneSession: { signature: string; frames: { direction: -1 | 1; carets: CaretClone[] }[] } | undefined;
    private occurrenceSession: { wholeWord: boolean; notFound: boolean; signature: string } | undefined;
    /* The last select next occurrence found no more, which a host may say. */
    occurrencesExhausted = false;
    private closers = new CloserTracker();
    private bracketCache?: { revision: number; language: string; index: BracketIndex };

    constructor(text = '') {
        this.rope = TextRope.from(text);
        this.textCache = { text };
    }

    getText(): string {
        return (this.textCache.text ??= this.rope.slice());
    }

    getLength(): number {
        return this.rope.length;
    }

    /* Counts up with every text change, undo and redo included, and never goes back to an earlier value. */
    getRevision(): number {
        return this.revision;
    }

    /* An empty document has one line, and a trailing line break adds an empty last one. */
    getLineCount(): number {
        return this.rope.lineCount;
    }

    /* Out of range lines are clamped. */
    getLine(line: number): DocumentLine {
        return this.rope.getLine(line);
    }

    /* Plain UTF-16 substring semantics, so it can cut a surrogate pair in half. */
    slice(from: number, to: number): string {
        return this.rope.slice(from, to);
    }

    getSelections(): readonly Selection[] {
        return this.selections.map((selection) => ({ ...selection }));
    }

    getSelectionCount(): number {
        return this.selections.length;
    }

    /* The caret added last, which is where the view scrolls to and what a language feature reads. */
    getPrimary(): Selection {
        return { ...this.selections.at(-1)! };
    }

    getSnapshot(): EditorSnapshot {
        const rope = this.rope;
        const cache = this.textCache;
        let text: string | undefined;
        return {
            // Bound to this version's rope, so a retained snapshot keeps its own text however the document moves on.
            get text() {
                return (text ??= cache.text ??= rope.slice());
            },
            set text(value: string) {
                text = value;
            },
            selections: this.getSelections(),
            revision: this.revision,
            canUndo: this.undoStack.length > 0,
            canRedo: this.redoStack.length > 0
        };
    }

    /* Ends the current history group. Listeners hear about it only when the selections changed. */
    setSelections(selections: readonly Selection[]): void {
        const normalized = normalizeSelections(this.rope, selections);
        this.groupOpen = false;
        this.occurrenceSession = undefined;
        this.cloneSession = undefined;
        this.selectionHistory = [];
        this.statementClosers.clear();
        if (sameSelections(this.selections, normalized)) {
            return;
        }
        this.selections = normalized;
        this.closers.prune(this.selections);
        this.emit();
    }

    subscribe(listener: (snapshot: EditorSnapshot) => void): Disposable {
        this.listeners.add(listener);
        return {
            dispose: () => {
                this.listeners.delete(listener);
            }
        };
    }

    /*
     * Applies simultaneous edits in the coordinates of the current text. Invalid or overlapping edits
     * throw before anything changes. Returns whether the text changed, which a no-op never does.
     */
    applyEdits(edits: readonly TextEdit[], options: DocumentEditOptions = {}): boolean {
        if (options.expectedRevision !== undefined && options.expectedRevision !== this.revision) {
            return false;
        }
        const unique = this.validateEdits(edits);
        const changed = unique.filter((edit) => changesText(this.rope, edit));
        let next = this.rope;
        for (let index = changed.length - 1; index >= 0; index--) {
            const edit = changed[index]!;
            next = next.replace(edit.from, edit.to, edit.text);
        }
        const nextSelections =
            options.selections ??
            this.selections.map((selection) => ({ anchor: mapOffset(selection.anchor, unique), head: mapOffset(selection.head, unique) }));
        // Several edits can cancel each other out, like moving a character and moving it back.
        const unchanged =
            next === this.rope || (changed.length > 1 && next.length === this.rope.length && next.equalsRange(this.rope, changed[0]!.from, changed.at(-1)!.to));
        if (unchanged) {
            if (options.selections) {
                this.setSelections(nextSelections);
            }
            return false;
        }

        const before = this.state();
        const firstLine = this.rope.lineAt(changed[0]!.from);
        const previous = this.rope;
        this.rope = next;
        this.invalidate();
        this.typingContexts.invalidate(firstLine);
        this.selections = normalizeSelections(this.rope, nextSelections);
        this.closers.map(changed);
        this.closers.prune(this.selections);
        this.revision++;
        const after = this.state();
        const changes = changed.map((edit) => ({ from: edit.from, to: edit.to, insertedLength: edit.text.length }));
        const last = this.undoStack.at(-1);
        if (
            options.historyGroup &&
            this.groupOpen &&
            last?.group === options.historyGroup &&
            last.after.rope === before.rope &&
            sameSelections(last.after.selections, before.selections)
        ) {
            last.after = after;
            last.changes.push(changes);
        } else {
            this.undoStack.push({ before, after, group: options.historyGroup, changes: [changes] });
        }
        if (this.undoStack.length > historyLimit) {
            this.undoStack.shift();
        }
        this.groupOpen = Boolean(options.historyGroup);
        this.redoStack = [];
        this.emit([changes], options.source ?? 'external', () => editsOf(previous, changed));
        return true;
    }

    /* Replaces everything as one undoable external edit. */
    setText(text: string): void {
        this.applyEdits([{ from: 0, to: this.rope.length, text }], { source: 'external' });
    }

    undo(): boolean {
        const entry = this.undoStack.pop();
        if (!entry) {
            return false;
        }
        this.redoStack.push(entry);
        this.restore(entry.before, [...entry.changes].reverse().map(inverseChanges));
        return true;
    }

    redo(): boolean {
        const entry = this.redoStack.pop();
        if (!entry) {
            return false;
        }
        this.undoStack.push(entry);
        this.restore(entry.after, entry.changes);
        return true;
    }

    positionAt(offset: number): Position {
        const clamped = offsetIn(this.rope, offset);
        const line = this.rope.lineAt(clamped);
        const bounds = this.rope.lineBounds(line);
        return { line, column: Math.min(clamped, bounds.end) - bounds.start };
    }

    /* A column past the end of its line lands on the end of the line, before the line break. */
    offsetAt(position: Position): number {
        const line = this.rope.lineBounds(position.line);
        return offsetIn(this.rope, line.start + clampInteger(position.column, line.end - line.start));
    }

    find(query: string, options: FindOptions = {}): FindMatch[] {
        return findMatches(this.getText(), query, this.revision, options);
    }

    /* Includes a match that starts at `from`, or ends there when searching backwards. */
    findNext(query: string, from = this.selections.at(-1)!.head, options: FindNextOptions = {}): FindMatch | null {
        const matches = this.find(query, options);
        const offset = clampInteger(from, this.rope.length);
        const ordered = options.backwards ? matches.reverse() : matches;
        const found = ordered.find((match) => (options.backwards ? match.to <= offset : match.from >= offset));
        return found ?? (options.wrap === false ? null : (ordered[0] ?? null));
    }

    /* Refuses a match from an earlier revision, or one whose text no longer sits there. */
    replace(match: FindMatch, replacement: string, options: ReplaceOptions = {}): boolean {
        if (match.revision !== this.revision || (options.expectedRevision !== undefined && options.expectedRevision !== this.revision)) {
            return false;
        }
        if (this.slice(match.from, match.to) !== match.text) {
            return false;
        }
        return this.applyEdits(
            [{ from: match.from, to: match.to, text: replacementText(this.getText(), match, replacement, options.literal, options.preserveCase) }],
            {
                source: 'command',
                ...options,
                expectedRevision: match.revision
            }
        );
    }

    /* One undo step. Returns the number of replacements, 0 when nothing changed. */
    replaceAll(query: string, replacement: string, options: ReplaceAllOptions = {}): number {
        if (options.expectedRevision !== undefined && options.expectedRevision !== this.revision) {
            return 0;
        }
        const matches = this.find(query, options);
        const text = this.getText();
        const edits = matches.map((match) => ({
            from: match.from,
            to: match.to,
            text: replacementText(text, match, replacement, options.literal, options.preserveCase)
        }));
        return this.applyEdits(edits, { source: 'command', ...options }) ? matches.length : 0;
    }

    getFoldingRanges(options: FoldingOptions = {}): FoldingRange[] {
        const ranges = options.brackets === false && options.comments === false ? [] : this.structure();
        const lineAt = (offset: number): number => this.rope.lineAt(offset);
        const getLine = (line: number): DocumentLine => this.getLine(line);
        const slice = (from: number, to: number): string => this.slice(from, to);
        const derived = deriveFoldingRanges(ranges, lineAt, this.getLineCount(), getLine, options, slice);
        if (options.language === undefined) {
            return derived;
        }
        const minimum = options.minLines === undefined ? 1 : Math.max(1, Math.trunc(options.minLines) || 1);
        // Listed first, so a fold that spans the same lines as a bracket pair is the import list and not the pair.
        const merged = [
            ...lexicalFolds(this.getLineCount(), getLine, options.language, options),
            ...blockFolds(this.getLineCount(), getLine, options.language),
            ...derived
        ].filter((range) => range.endLine - range.startLine >= minimum);
        merged.sort((left, right) => left.startLine - right.startLine || right.endLine - left.endLine);
        const unique = dedupeFoldingRanges(merged);
        markFileHeader(unique, getLine, this.getLineCount(), options.language);
        return options.hints === undefined ? unique : applyFoldHints(unique, options.hints, lineAt, getLine, slice, minimum);
    }

    /*
     * Types `text` at every caret as one keystroke would: it wraps a selection in a bracket or quote,
     * closes an opener, types over a closer that is already there and, in TypeScript, JavaScript and
     * PHP, moves a `;` to the end of a statement. Comments and string contents are left alone.
     * Returns whether anything changed, a swallowed closer included.
     */
    typeText(text: string, options: TypeTextOptions = {}): boolean {
        if (options.expectedRevision !== undefined && options.expectedRevision !== this.revision) {
            return false;
        }
        if (!text) {
            return false;
        }
        const language = options.language ?? 'typescript';
        const single = text.length === 1;
        const pairing = options.autoClosingPairs !== false && single && !isPlainText(language);
        const input: TypingInput = {
            text,
            language,
            brackets: pairing && options.autoClosingBrackets !== false,
            quotes: pairing && options.autoClosingQuotes !== false,
            surround: options.surroundSelection !== false && single,
            smartSemicolon: options.smartSemicolon !== false && hasSmartSemicolon(language),
            dedent: options.smartEnter !== false
        };
        const plans = this.selections.map((selection) => this.planTyping(selection, input));
        const transaction = selectionTransaction(plans);
        const textChanges = transaction.edits.some((edit) => changesText(this.rope, edit));
        const appliedRevision = this.revision + Number(textChanges);
        const changed = this.applySelectionEdits(
            plans,
            { source: 'input', historyGroup: options.historyGroup ?? 'typing', expectedRevision: options.expectedRevision },
            transaction
        );
        this.statementClosers.clear();
        if (this.revision === appliedRevision) {
            this.rememberStatementClosers(plans, transaction, language);
            this.rememberPairs(plans, transaction);
        }
        return changed || plans.some((plan) => plan.consumed);
    }

    /*
     * Pastes `text` at every selection. With as many lines as carets each caret takes one; `wholeLines`
     * marks text copied from a bare caret, which goes above the lines of bare carets.
     */
    paste(text: string, options: CommandOptions & { wholeLines?: boolean } = {}): boolean {
        const tabSize = tabWidth(options);
        const plan = planPaste(this.editSource(options.language ?? 'typescript'), this.selections, text, {
            tabSize,
            insertSpaces: options.insertSpaces !== false,
            wholeLines: options.wholeLines === true,
            reindent: options.indentOnPaste !== false
        });
        return this.applyEdits(plan.edits, { source: 'input', selections: plan.selections });
    }

    /* Runs a command on every caret. Returns whether the text or the selection changed. */
    execute(command: EditorCommand, options: CommandOptions = {}): boolean {
        if (command === 'undo') {
            return this.undo();
        }
        if (command === 'redo') {
            return this.redo();
        }
        if (command === 'selectAll') {
            return this.changeSelections([{ anchor: 0, head: this.rope.length }]);
        }
        if (command === 'expandSelection') {
            return this.expandSelection();
        }
        if (command === 'shrinkSelection') {
            return this.shrinkSelection();
        }
        if (command === 'smartHome' || command === 'smartEnd' || command === 'selectSmartHome' || command === 'selectSmartEnd') {
            return this.moveToLineEdge(command, tabWidth(options), options.visualLine);
        }
        const wordMatch = wordCommand.exec(command);
        if (wordMatch) {
            const camel = wordMatch[2]!.toLowerCase() === 'camel' || options.camelCase === true;
            return this.moveByWord(wordMatch[1] as 'select' | 'delete' | undefined, wordMatch[3] === 'Left' ? -1 : 1, camel);
        }
        if (command === 'addCaretAbove' || command === 'addCaretBelow') {
            return this.addCaret(command === 'addCaretAbove' ? -1 : 1);
        }
        if (command === 'selectNextOccurrence') {
            return this.selectNextOccurrence();
        }
        if (command === 'unselectOccurrence') {
            return this.unselectOccurrence();
        }
        if (command === 'selectAllOccurrences') {
            return this.selectAllOccurrences();
        }
        if (command === 'addCaretPerSelectedLine') {
            return this.addCaretPerSelectedLine();
        }
        const tabSize = tabWidth(options);
        const language = options.language ?? 'typescript';
        if (command === 'smartBackspace' || command === 'deleteForward') {
            const pairing = options.autoClosingPairs !== false && !isPlainText(language);
            return this.deleteCharacter(
                command === 'smartBackspace',
                tabSize,
                { brackets: pairing && options.autoClosingBrackets !== false, quotes: pairing && options.autoClosingQuotes !== false },
                language
            );
        }
        const unit = options.insertSpaces === false ? '\t' : ' '.repeat(tabSize);
        const enter = { language, unit, tabSize, smart: options.smartEnter !== false, reach: true };
        if (command === 'insertNewline' || command === 'startNewLine' || command === 'splitLine') {
            return this.insertNewline(enter, command === 'insertNewline' ? 'enter' : command === 'startNewLine' ? 'below' : 'split');
        }
        if (command === 'startNewLineBefore') {
            return this.startNewLineBefore(unit);
        }
        if (command === 'joinLines' || command === 'toggleCase' || command === 'autoIndentLines') {
            return this.editLines(command, { language, unit });
        }
        if (command === 'insertTab') {
            return this.insertTab(tabSize, options);
        }
        if (command === 'toggleLineComment' || command === 'toggleBlockComment') {
            return this.toggleComment(command, tabSize, options, language);
        }
        if (command === 'indent' || command === 'outdent') {
            return this.changeLineIndentation(command, tabSize, options);
        }
        const selectedLines = this.selectedLines();
        if (command === 'duplicateLine') {
            return this.duplicate();
        }
        if (command === 'deleteLine') {
            return this.deleteLines(selectedLines);
        }
        if (command === 'moveLineUp' || command === 'moveLineDown') {
            return this.moveLines(selectedLines, command === 'moveLineUp' ? -1 : 1);
        }
        return false;
    }

    /* Sorted, with duplicates dropped. Throws before anything changes if an edit is invalid. */
    private validateEdits(edits: readonly TextEdit[]): TextEdit[] {
        const sorted = [...edits].sort((left, right) => left.from - right.from || left.to - right.to);
        const unique: TextEdit[] = [];
        for (const edit of sorted) {
            if (!Number.isInteger(edit.from) || !Number.isInteger(edit.to) || edit.from < 0 || edit.to < edit.from || edit.to > this.rope.length) {
                throw new RangeError('Edit offsets must be ordered integers inside the document.');
            }
            if (typeof edit.text !== 'string') {
                throw new TypeError('Edit text must be a string.');
            }
            if (splitsSurrogate(this.rope, edit.from) || splitsSurrogate(this.rope, edit.to)) {
                throw new RangeError('Edit boundaries cannot split a UTF-16 surrogate pair.');
            }
            const previous = unique.at(-1);
            if (previous && edit.from === previous.from && edit.to === previous.to && edit.text === previous.text) {
                continue;
            }
            if (previous && (edit.from < previous.to || (edit.from === previous.from && edit.to === previous.to))) {
                throw new RangeError('Simultaneous edits must not overlap.');
            }
            unique.push({ ...edit });
        }
        return unique;
    }

    private planTyping(selection: Selection, input: TypingInput): SelectionEdit {
        const { text, language, smartSemicolon } = input;
        const { from, to } = rangeOf(selection);
        const after = this.rope.charAt(to);
        const quote = isQuote(text);
        const pairing = quote ? input.quotes : input.brackets;
        const pendingClosers = this.statementClosers.get(from);
        if (input.brackets && smartSemicolon && from === to && pendingClosers?.language === language && pendingClosers.text.startsWith(text)) {
            return { from, to, text: '', anchor: 0, head: 0, skip: true, consumed: true, completedClosers: pendingClosers.text.slice(1) };
        }

        const needsContext = text.length === 1 && (/[()[\]{}'"`<]/.test(text) || (text === ';' && smartSemicolon));
        const context = needsContext ? this.typingContext(from, language) : undefined;
        const insideQuote = context && (context.mode === 'quote' || context.mode === 'template') && context.quote === text && !context.escaped;
        if (pairing && from === to && after === text && (quote ? insideQuote : context?.mode === 'code' && context.bracket?.close === text)) {
            return { from, to, text: '', anchor: 1, head: 1, skip: true };
        }

        if (text === ';' && from === to && smartSemicolon && context?.mode === 'code') {
            const end = this.semicolonTarget(from, context);
            if (end !== undefined) {
                const existing = this.rope.charAt(end) === ';';
                return {
                    from: end,
                    to: end,
                    text: existing ? '' : ';',
                    anchor: 1,
                    head: 1,
                    skip: existing,
                    completedClosers: this.slice(from, end).replace(/[^)\]]/g, '')
                };
            }
        }

        if (from !== to && input.surround && (pairs[text] !== undefined || text === '<')) {
            const wrapped = this.surroundSelection(selection, input, context);
            if (wrapped) {
                return wrapped;
            }
        }

        if (pairing && pairs[text] !== undefined && from === to && this.shouldClosePair(from, text, after, context, input)) {
            return { from, to, text: text + pairs[text], anchor: 1, head: 1, paired: true };
        }

        if (input.dedent && from === to && /[)\]}]/.test(text) && context?.mode === 'code' && context.bracket?.close === text) {
            const dedented = this.dedentCloser(from, text, context.bracket.at);
            if (dedented) {
                return dedented;
            }
        }
        return { from, to, text, anchor: text.length, head: text.length };
    }

    /* A delimiter over a selection wraps it, or swaps the quotes of the string it is the quote of. */
    private surroundSelection(selection: Selection, input: TypingInput, context: TypingContext | undefined): SelectionEdit | null {
        const { text, language } = input;
        const { from, to } = rangeOf(selection);
        const selected = this.slice(from, to);
        if (input.quotes && isQuote(text) && selected.length === 1) {
            const swapped = swapQuotes(this.editSource(language), from, text);
            if (swapped) {
                return { from: swapped.from, to: swapped.to, text: swapped.text, anchor: swapped.caret, head: swapped.caret };
            }
        }
        const inCommentOrString = context !== undefined && context.mode !== 'code';
        if (replacesComparison(text, selected, inCommentOrString)) {
            return null;
        }
        const wrapped = surround(selected, text);
        const reversed = selection.anchor > selection.head;
        const start = 1;
        const end = 1 + wrapped.inner.length;
        return { from, to, text: wrapped.text, anchor: reversed ? end : start, head: reversed ? start : end };
    }

    /* A closer alone on its line goes back to the indentation of the line its opener is on. */
    private dedentCloser(offset: number, closer: string, opener: number): SelectionEdit | null {
        const index = this.rope.lineAt(offset);
        const line = this.rope.lineBounds(index);
        const before = this.slice(line.start, offset);
        if (!/^[\t ]*$/.test(before)) {
            return null;
        }
        const indent = this.getLine(this.rope.lineAt(opener)).text.match(/^[\t ]*/)?.[0] ?? '';
        if (indent === before) {
            return null;
        }
        return { from: line.start, to: offset, text: indent + closer, anchor: indent.length + 1, head: indent.length + 1 };
    }

    private shouldClosePair(offset: number, opener: string, after: string, context: TypingContext | undefined, input: TypingInput): boolean {
        const interpolation = this.isInterpolation(offset, opener, context);
        const quote = isQuote(opener);
        const followedByTerminator = quote ? !identifier.test(after) && after !== opener : !after || /[\s)\]}>,;:]/u.test(after);
        if (context?.mode !== 'code' && !interpolation) {
            return false;
        }
        if (!followedByTerminator && !(interpolation && after === '`')) {
            return false;
        }
        if (quote) {
            // A quote after a word is an apostrophe or the end of a string, not the start of one.
            return (
                !identifier.test(this.slice(step(this.rope, offset, -1), offset)) &&
                !this.escaped(offset) &&
                !this.completesTripleQuote(offset, opener, input.language)
            );
        }
        return !this.hasMatch(offset, opener, input.language);
    }

    /* The third quote of a Python docstring opener is typed as it is, since the pair that came before it is the empty string. */
    private completesTripleQuote(offset: number, quote: string, language: string): boolean {
        return /^(python|py)$/i.test(language) && quote !== '`' && this.slice(offset - 2, offset) === quote + quote;
    }

    /* Whether the bracket just typed at `offset` would find its closer in the text that already follows it. */
    private hasMatch(offset: number, opener: string, language: string): boolean {
        if (this.rope.length > matchScanLimit) {
            return false;
        }
        const text = this.getText();
        const scanned = scanBrackets(text.slice(0, offset) + opener + text.slice(offset), language);
        return scanned.pairs.has(offset);
    }

    /* Remembers the closers a smart semicolon stepped over for the caret that did it, so typing them again is absorbed. */
    private rememberStatementClosers(plans: readonly SelectionEdit[], transaction: SelectionTransaction, language: string): void {
        for (const [index, selection] of transaction.selections.entries()) {
            const closers = plans[index]?.completedClosers;
            if (!closers) {
                continue;
            }
            const caretIsThere = this.selections.some((current) => current.anchor === selection.anchor && current.head === selection.head);
            if (caretIsThere && closers.length > (this.statementClosers.get(selection.head)?.text.length ?? 0)) {
                this.statementClosers.set(selection.head, { text: closers, language });
            }
        }
    }

    private rememberPairs(plans: readonly SelectionEdit[], transaction: SelectionTransaction): void {
        for (const [index, selection] of transaction.selections.entries()) {
            if (plans[index]?.paired) {
                this.closers.add(selection.head - 1, selection.head);
            }
        }
    }

    /*
     * Tab without a selection: up to the next tab stop, or over a closer the editor inserted. With a
     * selection it indents the lines, as it does in front of other text.
     */
    private insertTab(tabSize: number, options: CommandOptions): boolean {
        if (this.selections.some((selection) => selection.anchor !== selection.head)) {
            return this.changeLineIndentation('indent', tabSize, options);
        }
        const tabOut = options.tabOutOfClosers !== false;
        return this.applySelectionEdits(
            this.selections.map((selection) => {
                const offset = selection.head;
                if (tabOut && this.closers.isCloserAt(offset)) {
                    return { from: offset, to: offset, text: '', anchor: 1, head: 1, skip: true };
                }
                const text = options.insertSpaces === false ? '\t' : ' '.repeat(tabSize - (this.columnOf(offset, tabSize) % tabSize));
                return { from: offset, to: offset, text, anchor: text.length, head: text.length };
            }),
            { source: 'command' }
        );
    }

    /* The visual column of an offset, with tabs going to the next tab stop. */
    private columnOf(offset: number, tabSize: number): number {
        return indentationColumn(this.slice(this.rope.lineBounds(this.rope.lineAt(offset)).start, offset), tabSize);
    }

    private moveToLineEdge(
        command: 'smartHome' | 'smartEnd' | 'selectSmartHome' | 'selectSmartEnd',
        tabSize: number,
        visualLine: VisualLineOf | undefined
    ): boolean {
        const home = command.endsWith('Home');
        const select = command.startsWith('select');
        return this.changeSelections(
            this.selections.map((selection) => {
                const head = home ? this.homeOffset(selection.head, tabSize, visualLine) : this.endOffset(selection.head, visualLine);
                return { anchor: select ? selection.anchor : head, head };
            })
        );
    }

    /* The first character on a line that is not a space or a tab, or -1 when there is none. */
    private firstNonSpace(line: DocumentLine): number {
        const found = line.text.search(/[^ \t]/);
        return found === -1 ? -1 : line.start + found;
    }

    /*
     * Home. On a wrapped row it goes to the row's start, and from there to the first character of the line.
     * On the line itself it alternates between the first character and the start: from the start to the
     * first character (or, on a blank line, to where the nearest line above begins), from anywhere in the
     * text to the first character, and from the first character or inside the indentation to the start.
     */
    private homeOffset(offset: number, tabSize: number, visualLine: VisualLineOf | undefined): number {
        const line = this.getLine(this.rope.lineAt(offset));
        const row = visualLine?.(offset) ?? line;
        if (row.start > line.start) {
            return offset > row.start ? row.start : Math.max(this.firstNonSpace(line), line.start);
        }
        const indent = this.firstNonSpace(line);
        if (offset === line.start) {
            return this.offsetAtColumn(line, this.smartIndentColumn(line.start, tabSize), tabSize);
        }
        return indent !== -1 && indent < offset ? indent : line.start;
    }

    /* The visual column of the first character of this line, or of the nearest line above that has one. */
    private smartIndentColumn(offset: number, tabSize: number): number {
        for (let index = this.rope.lineAt(offset); index >= 0; index--) {
            const line = this.getLine(index);
            const indent = this.firstNonSpace(line);
            if (indent !== -1) {
                return indentationColumn(line.text.slice(0, indent - line.start), tabSize);
            }
        }
        return 0;
    }

    /* The offset on a line at a visual column, with a tab as wide as the stop it goes to; a line that is shorter ends first. */
    private offsetAtColumn(line: DocumentLine, column: number, tabSize: number): number {
        if (column <= 0) {
            return line.start;
        }
        let width = 0;
        for (let index = 0; index < line.text.length && width < column; index++) {
            width += line.text[index] === '\t' ? tabSize - (width % tabSize) : 1;
            if (width >= column) {
                return line.start + index + 1;
            }
        }
        return line.end;
    }

    /*
     * End. On a wrapped row it goes to the end of the row's text and then to the row's end; from the row's
     * end it goes on to the end of the line's text and then to the line's end. Trailing spaces are skipped on
     * the way, and a stop at the end of the text sends the next one past them.
     */
    private endOffset(offset: number, visualLine: VisualLineOf | undefined): number {
        const line = this.getLine(this.rope.lineAt(offset));
        const row = visualLine?.(offset) ?? line;
        let end = row.end;
        if (offset === row.end && offset < this.rope.length) {
            end = line.end;
        }
        let target = end;
        for (let at = end - 1; at >= line.start; at--) {
            if (at > line.start && visualLine !== undefined && visualLine(at).start === at) {
                target = end;
                break;
            }
            const character = this.rope.charAt(at);
            if (character !== ' ' && character !== '\t') {
                break;
            }
            target = at;
        }
        return target === end || target === offset ? end : target;
    }

    private moveByWord(mode: 'select' | 'delete' | undefined, direction: -1 | 1, camel: boolean): boolean {
        if (mode === 'delete') {
            const stops = direction === 1 ? DELETE_FORWARD : DELETE_BACKWARD;
            return this.deleteRanges(
                this.selections.map((selection) => {
                    const head = selection.head === selection.anchor ? this.caretStop(selection.head, direction, stops, camel) : selection.anchor;
                    return { from: Math.min(selection.head, head), to: Math.max(selection.head, head), text: '' };
                })
            );
        }
        const stops = direction === 1 ? MOVE_FORWARD : MOVE_BACKWARD;
        return this.changeSelections(
            this.selections.map((selection) => {
                const head = this.caretStop(selection.head, direction, stops, camel);
                return { anchor: mode === 'select' ? selection.anchor : head, head };
            })
        );
    }

    /*
     * The next stop of a word move: a word edge as `stops` says, but never past the line stop, so a line
     * break is a stop of its own and an empty line is one. Nowhere to go leaves the offset where it is.
     */
    private caretStop(offset: number, direction: -1 | 1, stops: CaretStops, camel: boolean): number {
        const line = this.rope.lineAt(offset);
        const edge = direction === 1 ? this.nextLineStop(line, offset, stops.line) : this.previousLineStop(line, offset, stops.line);
        if (offset === edge) {
            return offset;
        }
        const isStop = (position: number): boolean =>
            ((stops.word !== 'start' && isWordBoundary(this.rope, position, camel, false)) ||
                (stops.word !== 'end' && isWordBoundary(this.rope, position, camel, true))) &&
            !splitsCluster(this.rope, position);
        let position = offset + direction;
        while (direction === 1 ? position < edge : position > edge) {
            if (isStop(position)) {
                break;
            }
            position += direction;
        }
        return position;
    }

    private nextLineStop(line: number, offset: number, stop: CaretStopAt): number {
        if (line + 1 >= this.rope.lineCount) {
            return this.rope.length;
        }
        const atEnd = offset === this.rope.lineBounds(line).end;
        if (!atEnd && stop !== 'start') {
            return this.rope.lineBounds(line).end;
        }
        return stop === 'end' ? this.rope.lineBounds(line + 1).end : this.rope.lineBounds(line + 1).start;
    }

    private previousLineStop(line: number, offset: number, stop: CaretStopAt): number {
        if (line === 0) {
            return 0;
        }
        const atStart = offset === this.rope.lineBounds(line).start;
        if (!atStart && stop !== 'end') {
            return this.rope.lineBounds(line).start;
        }
        return stop === 'start' ? this.rope.lineBounds(line - 1).start : this.rope.lineBounds(line - 1).end;
    }

    /*
     * A caret, and the selection with it, on the line above or below each caret, at the column the caret
     * came from even when a line in between is shorter. Pressed again the other way it takes back the carets
     * it added, one step at a time, before it adds any on that side.
     */
    private addCaret(direction: -1 | 1): boolean {
        const session = this.cloneSession;
        const frames = session !== undefined && session.signature === this.occurrenceSignature() ? session.frames : [];
        const top = frames.at(-1);
        if (top !== undefined && top.direction !== direction) {
            const taken = new Set(top.carets.map((clone) => `${clone.selection.anchor}:${clone.selection.head}`));
            const kept = this.selections.filter((selection) => !taken.has(`${selection.anchor}:${selection.head}`));
            frames.pop();
            const changed = this.changeSelections(kept.length > 0 ? kept : this.selections.slice(0, 1));
            this.cloneSession = { signature: this.occurrenceSignature(), frames };
            return changed;
        }
        const sources = top === undefined ? this.selections.map((selection) => this.cloneSource(selection)) : top.carets;
        const clones: CaretClone[] = [];
        for (const source of sources) {
            const clone = this.cloneOnto(source, direction, [...this.selections, ...clones.map((added) => added.selection)]);
            if (clone !== null) {
                clones.push(clone);
            }
        }
        if (clones.length === 0) {
            return false;
        }
        const changed = this.changeSelections([...this.selections, ...clones.map((clone) => clone.selection)]);
        frames.push({ direction, carets: clones });
        this.cloneSession = { signature: this.occurrenceSignature(), frames };
        return changed;
    }

    private cloneSource(selection: Selection): CaretClone {
        const { from, to } = rangeOf(selection);
        return {
            selection,
            caretColumn: this.positionAt(selection.head).column,
            startColumn: this.positionAt(from).column,
            endColumn: this.positionAt(to).column
        };
    }

    /* The clone of a caret on a neighboring line, or on the next one that can hold its selection; null at the end of the text or on top of another caret. */
    private cloneOnto(source: CaretClone, direction: -1 | 1, existing: readonly Selection[]): CaretClone | null {
        const { selection } = source;
        const { from, to } = rangeOf(selection);
        const startLine = this.rope.lineAt(from);
        const endLine = this.rope.lineAt(to);
        const caretLine = this.rope.lineAt(selection.head);
        for (let shift = direction; ; shift += direction) {
            const line = caretLine + shift;
            if (line < 0 || line >= this.getLineCount()) {
                return null;
            }
            const start = this.offsetAt({ line: startLine + shift, column: source.startColumn });
            const end = this.offsetAt({ line: endLine + shift, column: source.endColumn });
            if (from !== to && start === end) {
                continue;
            }
            const caret = this.offsetAt({ line, column: source.caretColumn });
            const cloned = from === to ? { anchor: caret, head: caret } : selection.head === to ? { anchor: start, head: end } : { anchor: end, head: start };
            const range = rangeOf(cloned);
            if (
                existing.some((other) => {
                    const taken = rangeOf(other);
                    return range.from === range.to && taken.from === taken.to ? range.from === taken.from : range.from < taken.to && range.to > taken.from;
                })
            ) {
                return null;
            }
            return { ...source, selection: cloned };
        }
    }

    private changeLineIndentation(command: 'indent' | 'outdent', tabSize: number, options: CommandOptions): boolean {
        const indentation = options.insertSpaces === false ? '\t' : ' '.repeat(tabSize);
        const edits = this.selectedLines().map((index) => {
            const line = this.getLine(index);
            if (command === 'indent') {
                return { from: line.start, to: line.start, text: indentation };
            }
            const length = line.text.startsWith('\t') ? 1 : Math.min(line.text.match(/^ */)?.[0].length ?? 0, tabSize);
            return { from: line.start, to: line.start + length, text: '' };
        });
        return this.applyEdits(edits, { source: 'command' });
    }

    private toggleComment(command: 'toggleLineComment' | 'toggleBlockComment', tabSize: number, options: CommandOptions, language: string): boolean {
        const commentOptions = { language, tabSize, insertSpaces: options.insertSpaces !== false, lineToken: options.commentToken };
        const source = this.editSource(language);
        const plan: EditPlan | null =
            command === 'toggleLineComment'
                ? planLineComments(source, this.selections, commentOptions)
                : planBlockComment(source, this.selections, commentOptions);
        return plan !== null && this.applyEdits(plan.edits, { source: 'command', selections: plan.selections });
    }

    /* The lines the carets and selections touch. A selection that ends at the start of a line does not touch it. */
    private selectedLines(): number[] {
        const indices = new Set<number>();
        for (const selection of this.selections) {
            const { from, to } = rangeOf(selection);
            const first = this.rope.lineAt(from);
            let last = this.rope.lineAt(to);
            if (to > from && this.rope.lineBounds(last).start === to) {
                last--;
            }
            for (let line = first; line <= last; line++) {
                indices.add(line);
            }
        }
        return [...indices].sort((left, right) => left - right);
    }

    /* A selection is copied in place, its copy selected; a caret duplicates its line and moves down with it. */
    private duplicate(): boolean {
        const carets = this.selections.filter((selection) => selection.anchor === selection.head);
        const lines = new Set<number>();
        for (const caret of carets) {
            lines.add(this.rope.lineAt(caret.head));
        }
        const groups = blocks([...lines].sort((left, right) => left - right));
        interface Copy {
            at: number;
            text: string;
            /* Where each selection that rides on this copy stands once `shift` characters went in before it. */
            select(shift: number): Selection[];
        }
        const copies: Copy[] = [];
        for (const selection of this.selections) {
            const { from, to } = rangeOf(selection);
            if (from !== to) {
                const text = this.slice(from, to);
                copies.push({ at: to, text, select: (shift) => [{ anchor: to + shift, head: to + shift + text.length }] });
            }
        }
        for (const group of groups) {
            const first = this.rope.lineBounds(group.first);
            const last = this.rope.lineBounds(group.last);
            const text = last.next > last.end ? this.slice(first.start, last.next) : this.newlineAt(group.last) + this.slice(first.start, last.end);
            const riders = carets.filter((caret) => {
                const line = this.rope.lineAt(caret.head);
                return line >= group.first && line <= group.last;
            });
            copies.push({
                at: last.next,
                text,
                select: (shift) => riders.map((caret) => ({ anchor: caret.anchor + shift + text.length, head: caret.head + shift + text.length }))
            });
        }
        copies.sort((left, right) => left.at - right.at);
        const edits: TextEdit[] = [];
        const selections: Selection[] = [];
        let shift = 0;
        for (const copy of copies) {
            selections.push(...copy.select(shift));
            const previous = edits.at(-1);
            if (previous?.from === copy.at) {
                previous.text += copy.text;
            } else {
                edits.push({ from: copy.at, to: copy.at, text: copy.text });
            }
            shift += copy.text.length;
        }
        return this.applyEdits(edits, { source: 'command', selections });
    }

    /* The next line takes the caret in at the same column, or the one above when there is none. */
    private deleteLines(indices: readonly number[]): boolean {
        const groups = blocks(indices);
        const columns = new Map<number, number>();
        for (const selection of this.selections) {
            columns.set(this.rope.lineAt(selection.head), this.positionAt(selection.head).column);
        }
        const edits = groups.map((block) => {
            let from = this.rope.lineBounds(block.first).start;
            const to = this.rope.lineBounds(block.last).next;
            // The last line has no break of its own, so the one before it goes too.
            if (block.last === this.getLineCount() - 1 && block.first > 0) {
                from = this.rope.lineBounds(block.first - 1).end;
            }
            return { from, to, text: '' };
        });
        const selections: Selection[] = [];
        let removed = 0;
        for (const [position, block] of groups.entries()) {
            const edit = edits[position]!;
            const column = Math.max(0, ...[...columns].filter(([line]) => line >= block.first && line <= block.last).map(([, value]) => value));
            const target = block.last + 1 < this.getLineCount() ? block.last + 1 : block.first - 1;
            if (target >= 0) {
                const bounds = this.rope.lineBounds(target);
                const start = bounds.start - (block.last + 1 < this.getLineCount() ? edit.to - edit.from : 0) - removed;
                const caret = start + Math.min(column, bounds.end - bounds.start);
                selections.push({ anchor: caret, head: caret });
            } else {
                selections.push({ anchor: 0, head: 0 });
            }
            removed += edit.to - edit.from;
        }
        return this.applyEdits(edits, { source: 'command', selections });
    }

    private moveLines(indices: readonly number[], direction: -1 | 1): boolean {
        const groups = blocks(indices).filter((block) => (direction === -1 ? block.first > 0 : block.last < this.getLineCount() - 1));
        if (groups.length === 0) {
            return false;
        }
        const targets = new Map<number, { start: number; end: number; next: number }>();
        const edits = groups.map((block) => {
            const first = direction === -1 ? block.first - 1 : block.first;
            const last = direction === 1 ? block.last + 1 : block.last;
            const order: number[] = [];
            for (let line = block.first; line <= block.last; line++) {
                order.push(line);
            }
            if (direction === -1) {
                order.push(first);
            } else {
                order.unshift(last);
            }
            let at = this.rope.lineBounds(first).start;
            const from = at;
            const parts: string[] = [];
            for (const [index, original] of order.entries()) {
                const line = this.getLine(original);
                // Each line keeps the line break of the slot it moves into, so mixed LF and CRLF stay where they were.
                const slot = this.rope.lineBounds(first + index);
                const ending = this.slice(slot.end, slot.next);
                parts.push(line.text, ending);
                targets.set(original, { start: at, end: at + line.text.length, next: at + line.text.length + ending.length });
                at += line.text.length + ending.length;
            }
            return { from, to: this.rope.lineBounds(last).next, text: parts.join('') };
        });
        const mapOffsetThroughMove = (offset: number, from: number, to: number): number => {
            const line = this.rope.lineAt(offset);
            if (to > from && offset === to && line > 0 && this.rope.lineBounds(line).start === to) {
                return (targets.get(line - 1) ?? this.rope.lineBounds(line - 1)).next;
            }
            const target = targets.get(line);
            return target ? Math.min(target.end, target.start + offset - this.rope.lineBounds(line).start) : offset;
        };
        const selections = this.selections.map((selection) => {
            const { from, to } = rangeOf(selection);
            return { anchor: mapOffsetThroughMove(selection.anchor, from, to), head: mapOffsetThroughMove(selection.head, from, to) };
        });
        return this.applyEdits(edits, { source: 'command', selections });
    }

    /* Enter, or the same Enter from the end of the line (`below`) or with the caret left in front of the break (`split`). */
    private insertNewline(options: EnterOptions, mode: 'enter' | 'below' | 'split'): boolean {
        const source = this.editSource(options.language);
        const plan = (reach: boolean): EnterPlan[] =>
            this.selections.map((selection) => {
                const { from, to } = rangeOf(selection);
                if (mode === 'below') {
                    const end = this.rope.lineBounds(this.rope.lineAt(selection.head)).end;
                    return planEnter(source, end, end, { ...options, reach });
                }
                const before = this.slice(this.rope.lineBounds(this.rope.lineAt(from)).start, from);
                if (mode === 'split' && /^[\t ]*$/.test(before)) {
                    const start = from - before.length;
                    return { from: start, to: start, text: before + this.newlineAt(this.rope.lineAt(from)), caret: before.length };
                }
                const planned = planEnter(source, from, to, { ...options, reach });
                return mode === 'split' ? { ...planned, caret: from - planned.from } : planned;
            });
        let plans = plan(true);
        const sorted = [...plans].sort((left, right) => left.from - right.from);
        if (sorted.some((current, index) => index > 0 && current.from < sorted[index - 1]!.to)) {
            plans = plan(false);
        }
        return this.applySelectionEdits(
            plans.map((entry) => ({ from: entry.from, to: entry.to, text: entry.text, anchor: entry.caret, head: entry.caret })),
            { source: 'command' }
        );
    }

    /* A line of its own above each caret's line, at the indentation of its text. */
    private startNewLineBefore(unit: string): boolean {
        return this.applySelectionEdits(
            this.selections.map((selection) => {
                const index = this.rope.lineAt(selection.head);
                const line = this.rope.lineBounds(index);
                const text = this.getLine(index).text;
                const indent = (text.match(/^[\t ]*/)?.[0] ?? '') + (/^[\t ]*[)\]}]/.test(text) ? unit : '');
                return { from: line.start, to: line.start, text: indent + this.newlineAt(index), anchor: indent.length, head: indent.length };
            }),
            { source: 'command' }
        );
    }

    private editLines(command: 'joinLines' | 'toggleCase' | 'autoIndentLines', options: { language: string; unit: string }): boolean {
        const source = this.editSource(options.language);
        const plan: EditPlan | null =
            command === 'joinLines'
                ? planJoinLines(source, this.selections, options)
                : command === 'toggleCase'
                  ? planToggleCase(source, this.selections)
                  : planAutoIndent(source, this.selectedLines(), options);
        if (plan === null) {
            return false;
        }
        const edits = [...plan.edits].sort((left, right) => left.from - right.from);
        // Without a plan of its own the selections keep their start in front of the indentation that goes in at it.
        const selections =
            plan.selections.length > 0
                ? plan.selections
                : this.selections.map((selection) => {
                      const { from, to } = rangeOf(selection);
                      const start = mapOffset(from, edits, from !== to);
                      const end = mapOffset(to, edits);
                      return selection.anchor <= selection.head ? { anchor: start, head: end } : { anchor: end, head: start };
                  });
        return this.applyEdits(plan.edits, { source: 'command', selections });
    }

    private editSource(language: string): EditSource {
        return {
            lineCount: this.getLineCount(),
            slice: (from, to) => this.slice(from, to),
            charAt: (offset) => this.rope.charAt(offset),
            lineAt: (offset) => this.rope.lineAt(offset),
            line: (index) => this.getLine(index),
            newline: (index) => this.newlineAt(index),
            context: (offset) => this.typingContext(offset, language),
            region: (line) => (/^vue$/i.test(language) ? vueRegionAt((index) => this.getLine(index).text, line) : null),
            unmatchedBrace: (offset) => this.bracketIndex(language)?.unmatched.has(offset) ?? false
        };
    }

    /* Undefined for a document too large to scan on every Enter. */
    private bracketIndex(language: string): BracketIndex | undefined {
        if (this.rope.length > bracketScanLimit) {
            return undefined;
        }
        const cache = this.bracketCache;
        if (cache?.revision === this.revision && cache.language === language) {
            return cache.index;
        }
        const index = scanBrackets(this.getText(), language);
        this.bracketCache = { revision: this.revision, language, index };
        return index;
    }

    private deleteCharacter(backwards: boolean, tabSize: number, pairing: { brackets: boolean; quotes: boolean }, language: string): boolean {
        return this.deleteRanges(
            this.selections.map((selection) => {
                let { from, to } = rangeOf(selection);
                if (from === to) {
                    if (!backwards) {
                        to = deletionStep(this.rope, to, 1);
                    } else if ((isQuote(this.rope.charAt(from - 1)) ? pairing.quotes : pairing.brackets) && this.isEmptyPair(from, language)) {
                        from--;
                        to++;
                    } else {
                        from = this.backspaceStart(from, tabSize);
                    }
                }
                return { from, to, text: '' };
            })
        );
    }

    /* Whether the caret sits between an opener and its own closer, which backspace removes together. */
    private isEmptyPair(offset: number, language: string): boolean {
        const opener = this.rope.charAt(offset - 1);
        const closer = this.rope.charAt(offset);
        if (!closer || pairs[opener] !== closer || this.escaped(offset - 1)) {
            return false;
        }
        const context = this.typingContext(offset - 1, language);
        return context.mode === 'code' || this.isInterpolation(offset - 1, opener, context);
    }

    /* Backspace inside the indentation of a line goes back to the previous tab stop, and at the start of a line joins it with the one above. */
    private backspaceStart(offset: number, tabSize: number): number {
        const line = this.rope.lineBounds(this.rope.lineAt(offset));
        if (offset === line.start && line.start > 0) {
            // Joining with the line above also takes the whitespace that trails it.
            const previous = this.getLine(this.rope.lineAt(offset) - 1);
            return previous.end - trailingBlankLength(previous.text);
        }
        const prefix = this.slice(line.start, offset);
        if (prefix.length > 0 && /^[\t ]+$/.test(prefix)) {
            return line.start + indentStopLength(prefix, tabSize);
        }
        return deletionStep(this.rope, offset, -1);
    }

    private deleteRanges(ranges: TextEdit[]): boolean {
        ranges.sort((left, right) => left.from - right.from);
        const merged: TextEdit[] = [];
        for (const range of ranges) {
            const previous = merged.at(-1);
            if (previous && range.from <= previous.to) {
                previous.to = Math.max(previous.to, range.to);
            } else {
                merged.push({ ...range });
            }
        }
        return this.applyEdits(merged, { source: 'command' });
    }

    private applySelectionEdits(plans: readonly SelectionEdit[], options: DocumentEditOptions, transaction = selectionTransaction(plans)): boolean {
        const before = this.getSelections();
        const changed = this.applyEdits(transaction.edits, { ...options, selections: transaction.selections });
        return changed || !sameSelections(before, this.selections);
    }

    /* The line break of a line, or the document's first one for the last line, which has none. */
    private newlineAt(index: number): string {
        const line = this.rope.lineBounds(index);
        if (line.next > line.end) {
            return this.slice(line.end, line.next);
        }
        const first = this.rope.lineBounds(0);
        return first.next > first.end ? this.slice(first.end, first.next) : '\n';
    }

    /* Whether the character at `offset` is preceded by an odd number of backslashes. */
    private escaped(offset: number): boolean {
        let count = 0;
        while (offset > 0 && this.rope.charAt(--offset) === '\\') {
            count++;
        }
        return count % 2 === 1;
    }

    private typingContext(offset: number, language: string): TypingContext {
        const position = this.positionAt(offset);
        return this.typingContexts.at(position.line, position.column, language);
    }

    private isInterpolation(offset: number, character: string, context?: TypingContext): boolean {
        return character === '{' && this.rope.charAt(offset - 1) === '$' && context?.mode === 'template' && !context.escaped && !this.escaped(offset - 1);
    }

    /*
     * Where a `;` typed at `from` belongs: after the closing brackets of the call or array that ends
     * the statement. Undefined when it is an ordinary `;`, as in a `for` header or mid-expression.
     */
    private semicolonTarget(from: number, context: TypingContext): number | undefined {
        for (let bracket = context.bracket; bracket; bracket = bracket.previous) {
            if (bracket.control) {
                return undefined;
            }
        }
        if (this.rope.charAt(from) === ';') {
            return from;
        }
        const line = this.getLine(this.rope.lineAt(from));
        const prefix = this.slice(line.start, from).trimEnd();
        if (!prefix || /[([,=:+\-*/%&|!?]$/.test(prefix)) {
            return undefined;
        }
        let target = from;
        let bracket = context.bracket;
        while (target < line.end) {
            const character = this.rope.charAt(target);
            if (character === ' ' || character === '\t') {
                target++;
                continue;
            }
            if ((character !== ')' && character !== ']') || bracket?.close !== character) {
                break;
            }
            target++;
            bracket = bracket.previous;
        }
        if (target === from || !/[)\]]/.test(this.slice(from, target))) {
            return undefined;
        }
        const after = this.rope.charAt(target);
        if (target !== line.end && after !== ';' && after !== '}' && this.slice(target, target + 2) !== '//') {
            return undefined;
        }
        // Whitespace after the expression stays after its terminator.
        if (after !== ';') {
            while (target > from && /[\t ]/.test(this.rope.charAt(target - 1))) {
                target--;
            }
        }
        return target;
    }

    /*
     * What a double click selects at an offset: the identifier around it, a hump of it when `camel`,
     * and on anything else the text of its line. On an empty line it is the whole document, as the
     * platform's select-word action has it.
     */
    wordSelectionAt(offset: number, camel = false): { from: number; to: number } | null {
        const length = this.rope.length;
        const at = offset >= length ? length - 1 : offset;
        if (at < 0) {
            return null;
        }
        const word = this.identifierRunAt(at, camel);
        if (word !== null) {
            return word;
        }
        const line = this.getLine(this.rope.lineAt(at));
        return line.start === line.end ? { from: 0, to: length } : { from: line.start, to: line.end };
    }

    /* The identifier, or its camel hump, that an offset is in or at the end of; null when it is on something else. */
    private identifierRunAt(offset: number, camel: boolean): { from: number; to: number } | null {
        const length = this.rope.length;
        const isWord = (at: number): boolean => at >= 0 && at < length && identifier.test(this.slice(at, step(this.rope, at, 1)));
        let at = offset;
        if (at > 0 && !isWord(at) && isWord(at - 1)) {
            at--;
        }
        if (!isWord(at)) {
            return null;
        }
        if (camel) {
            let start = at;
            let end = at + 1;
            while (start > 0 && isWord(start - 1) && !isHumpBoundary(this.rope, start, true)) {
                start--;
            }
            while (end < length && isWord(end) && !isHumpBoundary(this.rope, end, false)) {
                end++;
            }
            if (start + 1 < end) {
                return { from: start, to: end };
            }
        }
        const word = this.wordRange(at);
        return word.from === word.to ? null : word;
    }

    /* Where the word before an offset starts on this line or the one above, as a drag over words follows it. */
    wordStartBefore(offset: number, camel = false): number {
        if (offset === 0) {
            return 0;
        }
        const line = this.rope.lineAt(offset);
        const minimum = line > 0 ? this.rope.lineBounds(line - 1).end : 0;
        let found = offset - 1;
        for (; found > minimum; found--) {
            if (isWordBoundary(this.rope, found, camel, true) || this.isBetweenBrackets(found)) {
                break;
            }
        }
        return found;
    }

    /* Where the word after an offset ends on this line or the one below. */
    wordEndAfter(offset: number, camel = false): number {
        if (offset >= this.rope.length - 1) {
            return offset;
        }
        const line = this.rope.lineAt(offset);
        let found = offset + 1;
        let maximum = this.rope.lineBounds(line).end;
        if (found > maximum) {
            if (line + 1 >= this.rope.lineCount) {
                return offset;
            }
            maximum = this.rope.lineBounds(line + 1).end;
        }
        for (; found < maximum; found++) {
            if (isWordBoundary(this.rope, found, camel, false) || this.isBetweenBrackets(found)) {
                break;
            }
        }
        return found;
    }

    private isBetweenBrackets(offset: number): boolean {
        return offset > 0 && offset < this.rope.length && /[()[\]<>{}]/.test(this.rope.charAt(offset)) && /[()[\]<>{}]/.test(this.rope.charAt(offset - 1));
    }

    private wordRange(offset: number): { from: number; to: number } {
        let from = offset;
        let to = offset;
        while (from > 0) {
            const previous = step(this.rope, from, -1);
            if (!identifier.test(this.slice(previous, from))) {
                break;
            }
            from = previous;
        }
        while (to < this.rope.length) {
            const next = step(this.rope, to, 1);
            if (!identifier.test(this.slice(to, next))) {
                break;
            }
            to = next;
        }
        return { from, to };
    }

    /* Grows each selection to the smallest word, line, bracket or string around it that is larger than it. */
    private expandSelection(given: readonly (OffsetRange | null)[] = []): boolean {
        const selections = this.selections.map((selection, index) => {
            const { from, to } = rangeOf(selection);
            const candidate = this.largerRange(given[index] ?? null, from, to) ?? this.lexicalExpansion(selection, from, to);
            if (!candidate) {
                return selection;
            }
            return selection.anchor > selection.head ? { anchor: candidate.to, head: candidate.from } : { anchor: candidate.from, head: candidate.to };
        });
        const normalized = normalizeSelections(this.rope, selections);
        if (sameSelections(this.selections, normalized)) {
            return false;
        }
        this.selectionHistory.push(this.selections.map((selection) => ({ ...selection })));
        this.selections = normalized;
        this.groupOpen = false;
        this.emit();
        return true;
    }

    /*
     * Grows each selection to the range a language server gave for it, by offsets in the text, and Shrink
     * Selection walks back. A selection without a range, or one that does not hold it and more, grows
     * by the same rule as `expandSelection`.
     */
    expandSelectionTo(ranges: readonly (OffsetRange | null)[]): boolean {
        return this.expandSelection(ranges);
    }

    /* The range when it holds the stretch and is larger than it, else null. */
    private largerRange(range: OffsetRange | null, from: number, to: number): OffsetRange | null {
        return range !== null && range.from <= from && range.to >= to && (range.from < from || range.to > to) ? range : null;
    }

    private lexicalExpansion(selection: Selection, from: number, to: number): OffsetRange | undefined {
        const first = this.getLine(this.rope.lineAt(from));
        const last = this.getLine(this.rope.lineAt(to));
        const candidates = [
            this.wordRange(selection.head),
            { from: first.start, to: last.end },
            { from: first.start, to: last.next },
            { from: 0, to: this.rope.length }
        ];
        if (first.start === last.start) {
            candidates.push({ from: first.start + indentLength(first.text), to: first.end - trailingBlankLength(first.text) });
        }
        for (const range of this.structure()) {
            candidates.push({ from: range.innerFrom, to: range.innerTo }, range);
        }
        return candidates
            .filter((range) => range.from <= from && range.to >= to && (range.from < from || range.to > to))
            .sort((left, right) => left.to - left.from - (right.to - right.from))[0];
    }

    private shrinkSelection(): boolean {
        const previous = this.selectionHistory.pop();
        if (!previous) {
            return false;
        }
        this.selections = previous;
        this.groupOpen = false;
        this.emit();
        return true;
    }

    /* Whether the selections are as the last occurrence command left them, which makes the next one a repeat of it. */
    private occurrenceSignature(): string {
        return this.selections.map((selection) => `${selection.anchor}:${selection.head}`).join(',');
    }

    private repeatedOccurrence(): { wholeWord: boolean; notFound: boolean } | null {
        const session = this.occurrenceSession;
        return session !== undefined && session.signature === this.occurrenceSignature() ? session : null;
    }

    private rememberOccurrence(wholeWord: boolean, notFound: boolean): void {
        this.occurrenceSession = { wholeWord, notFound, signature: this.occurrenceSignature() };
        this.occurrencesExhausted = notFound;
    }

    /* Whether a range touches a selection that is already there. */
    private overlapsSelection(from: number, to: number): boolean {
        return this.selections.some((selection) => {
            const range = rangeOf(selection);
            return from === to && range.from === range.to ? from === range.from : from < range.to && to > range.from;
        });
    }

    /*
     * A caret on the next occurrence of what is selected, a word to begin with, whose later occurrences have to be
     * whole words too. An occurrence that is already a selection is left, and so is the end of the text: the next
     * press starts again from its beginning.
     */
    private selectNextOccurrence(): boolean {
        const repeated = this.repeatedOccurrence();
        const notFoundBefore = repeated?.notFound === true;
        const wholeWord = repeated?.wholeWord === true;
        const primary = this.selections.at(-1)!;
        const { from, to } = rangeOf(primary);
        if (from === to) {
            const word = this.identifierRunAt(primary.head, false);
            if (word === null) {
                return false;
            }
            const changed = this.changeSelections([...this.selections.slice(0, -1), { anchor: word.from, head: word.to }]);
            this.rememberOccurrence(true, false);
            return changed;
        }
        const needle = this.slice(from, to);
        const start = notFoundBefore ? 0 : to;
        const match = this.find(needle, { caseSensitive: true, wholeWord }).find((candidate) => candidate.from >= start);
        if (match === undefined) {
            this.rememberOccurrence(wholeWord, true);
            return false;
        }
        if (this.overlapsSelection(match.from, match.to)) {
            this.rememberOccurrence(wholeWord, notFoundBefore);
            return false;
        }
        const shift = primary.head - from;
        const caret = Math.min(match.from + shift, match.to);
        const added = shift === 0 ? { anchor: match.to, head: match.from } : { anchor: caret === match.to ? match.from : match.to, head: caret };
        const changed = this.changeSelections([...this.selections, added]);
        this.rememberOccurrence(wholeWord, false);
        return changed;
    }

    /* Takes the newest caret away, or the selection when there is one caret. */
    private unselectOccurrence(): boolean {
        const changed =
            this.selections.length > 1
                ? this.changeSelections(this.selections.slice(0, -1))
                : this.changeSelections([{ anchor: this.selections[0]!.head, head: this.selections[0]!.head }]);
        this.occurrenceSession = undefined;
        this.occurrencesExhausted = false;
        return changed;
    }

    /* A caret on every occurrence of the selected text, or of the word at the caret as a whole word, the last one primary. */
    private selectAllOccurrences(): boolean {
        const primary = this.selections.at(-1)!;
        let { from, to } = rangeOf(primary);
        let wholeWord = false;
        if (from === to) {
            const word = this.identifierRunAt(primary.head, false);
            if (word === null) {
                return false;
            }
            ({ from, to } = word);
            wholeWord = true;
        }
        // The word that was only a caret gets selected forward, so its caret is at its end.
        const shift = wholeWord ? to - from : primary.head - from;
        const matches = this.find(this.slice(from, to), { caseSensitive: true, wholeWord });
        if (matches.length === 0) {
            return false;
        }
        const changed = this.changeSelections(
            matches.map((match) => {
                const caret = Math.min(match.from + shift, match.to);
                return shift === 0 ? { anchor: match.to, head: match.from } : { anchor: caret === match.to ? match.from : match.to, head: caret };
            })
        );
        this.rememberOccurrence(wholeWord, false);
        return changed;
    }

    /* The selected lines become a caret at the end of each, which is where the platform puts them. */
    private addCaretPerSelectedLine(): boolean {
        const forward = this.selections.at(-1)!.head >= this.selections.at(-1)!.anchor;
        const carets: Selection[] = [];
        for (const selection of this.selections) {
            const { from, to } = rangeOf(selection);
            const first = this.rope.lineAt(from);
            let last = this.rope.lineAt(to);
            if (last > first && to === this.rope.lineBounds(last).start) {
                last--;
            }
            for (let line = first; line <= last; line++) {
                const end = this.rope.lineBounds(line).end;
                carets.push({ anchor: end, head: end });
            }
        }
        // The primary caret is the one at the end the selection was dragged to.
        const primary = forward ? carets.pop() : carets.shift();
        return this.changeSelections(primary === undefined ? carets : [...carets, primary]);
    }

    private changeSelections(selections: readonly Selection[]): boolean {
        const before = this.getSelections();
        this.setSelections(selections);
        return !sameSelections(before, this.selections);
    }

    private structure(): StructureRange[] {
        return (this.structureCache ??= scanStructure(this.getText()));
    }

    private state(): State {
        return { rope: this.rope, selections: this.selections.map((selection) => ({ ...selection })) };
    }

    private invalidate(): void {
        this.textCache = {};
        this.structureCache = undefined;
        this.selectionHistory = [];
        this.statementClosers.clear();
    }

    private restore(state: State, changes: readonly (readonly DocumentChange[])[]): void {
        const previous = this.rope;
        this.rope = state.rope;
        this.invalidate();
        this.closers.clear();
        this.typingContexts.invalidate();
        this.selections = state.selections.map((selection) => ({ ...selection }));
        this.revision++;
        this.groupOpen = false;
        this.emit(changes, 'command', () => stretchEdits(previous, state.rope, changes));
    }

    /* `contentEdits` is worked out when a listener asks, since most listeners never do and a restore of a large text would otherwise read all of it. */
    private emit(changes?: readonly (readonly DocumentChange[])[], source?: EditorSnapshot['source'], contentEdits?: () => ContentEdit[]): void {
        const snapshot = this.getSnapshot();
        if (changes) {
            snapshot.changes = changes.map((transaction) => transaction.map((change) => ({ ...change })));
            snapshot.source = source;
            if (contentEdits) {
                let edits: ContentEdit[] | undefined;
                Object.defineProperty(snapshot, 'contentEdits', { get: () => (edits ??= contentEdits()), enumerable: true });
            }
        }
        for (const listener of this.listeners) {
            listener(snapshot);
        }
    }
}

import i18next from 'i18next';
import { StaleResultError, type CompletionContext, type CompletionItem } from '@ruimte/smart-editor-lsp';
import type { EditorContentChange, EditorPosition, EditorRange, EditorTextChange } from '@ruimte/smart-editor';
import { useToasts } from '@/state/toasts';
import { comparePositions, shiftPosition } from './diagnostics-model';
import type { EditorLanguage } from './editor-language';
import {
    completionDocsOf,
    identifierPrefix,
    insertionOf,
    isIdentifierCharacter,
    itemsOf,
    matchedCharacters,
    prefixFor,
    qualifiersOf,
    rankCompletions,
    type Ranked
} from './completion-model';
import { RecentChoices, recentChoicesOf } from './recent-choices';
import { shikiLanguageOf } from './language-ids';
import type { CompletionRow, CompletionView } from './popups';
import { realTimers, type Timers } from './timers';

const METHOD = 'textDocument/completion';
const START_DELAY_MS = 80;
/* After typing stops, the list is asked for again at the new text: a server only resolves an item for the text it was made for. */
const REFRESH_DELAY_MS = 150;
const RESOLVE_DELAY_MS = 120;
const PAGE = 8;
const TOAST_ID = 'language-completion';

function isEmpty(range: EditorRange): boolean {
    return comparePositions(range.start, range.end) === 0;
}

/*
 * The suggestions that open while a word is typed. A single typed identifier character or a trigger
 * character of the server asks for the list; every character after that only filters the list that
 * is already there, unless the server called it incomplete. Enter inserts, Tab replaces, Escape closes.
 */
export class CompletionFeature {
    private readonly language: EditorLanguage;
    private readonly timers: Timers;
    private pool: readonly CompletionItem[] = [];
    private incomplete = false;
    private ranked: readonly Ranked[] = [];
    private active = 0;
    /* Whether the person moved in the list; until then the active row is the best match, whatever the typing does to the list. */
    private touched = false;
    private activeKey: string | null = null;
    /* Asked for with the keyboard, which is as good as moving in the list when a commit character is typed. */
    private explicit = false;
    private detailsOpen = true;
    private start: EditorPosition | null = null;
    private server = '';
    private request = 0;
    private controller: AbortController | null = null;
    private requestTimer: unknown;
    private refreshTimer: unknown;
    private resolveTimer: unknown;
    private readonly resolved = new Map<CompletionItem, CompletionItem>();

    constructor(language: EditorLanguage, timers: Timers = realTimers) {
        this.language = language;
        this.timers = timers;
        const { editor } = language;
        const offs = [
            editor.onKeyDown((event) => this.key(event)),
            editor.onTextChange((change) => this.edited(change)),
            editor.onCaret((position) => this.caretMoved(position)),
            editor.onBlur(() => this.close())
        ];
        language.onDispose(() => {
            for (const off of offs) {
                off();
            }
            this.close();
        });
    }

    get isOpen(): boolean {
        return this.language.popups.getState().completion !== null;
    }

    /* Asks for suggestions at the caret now, as Ctrl+Space does. */
    invoke(): void {
        this.explicit = true;
        this.beginRequest({ triggerKind: 1 }, 0);
    }

    move(delta: number): void {
        if (this.ranked.length === 0) {
            return;
        }
        const last = this.ranked.length - 1;
        // One step past either end goes round, a page does not.
        this.active = Math.abs(delta) === 1 ? (this.active + delta + last + 1) % (last + 1) : Math.max(0, Math.min(last, this.active + delta));
        this.touched = true;
        this.publish();
        this.scheduleResolve();
    }

    /* Picks a row by a click or a key. */
    async accept(replace: boolean, index = this.active, commit?: string): Promise<void> {
        const entry = this.ranked[index];
        if (entry === undefined) {
            return;
        }
        const { editor, project, uri } = this.language;
        recentChoicesOf(this.language.languageId).record(entry.item);
        let item = this.resolved.get(entry.item) ?? entry.item;
        const needsResolve = !this.resolved.has(entry.item) && project.service.providerOptions('completionItem/resolve', uri) !== undefined;
        this.close();
        if (needsResolve) {
            // Resolving can add the import an item needs; an item that cannot be resolved is still inserted as it is.
            item = await this.resolveNow(entry.item);
        }
        const caret = editor.getCaret();
        const lineBefore = editor.textInRange({ start: { line: caret.line, character: 0 }, end: caret });
        const lineAfter = editor.textInRange({ start: caret, end: { line: caret.line, character: Number.MAX_SAFE_INTEGER } });
        // A character that commits is typed after the name, so a call is not added before it.
        const main = insertionOf(item, caret, lineBefore, replace, commit === undefined ? lineAfter : '(');
        const extras = (item.additionalTextEdits ?? []).map((edit): EditorContentChange => ({ range: edit.range, text: edit.newText }));
        // An import above the insertion moves it, and the tab stops are measured from where it ends up.
        const start = extras
            .filter((extra) => comparePositions(extra.range.end, main.range.start) <= 0)
            .sort((left, right) => comparePositions(right.range.start, left.range.start))
            .reduce((place, extra) => shiftPosition(place, extra), main.range.start);
        editor.applyEdits([{ range: main.range, text: main.text }, ...extras]);
        if (commit === undefined) {
            this.language.snippets.begin(start, main.text, main.stops);
        } else {
            const end = editor.getCaret();
            editor.applyEdits([{ range: { start: end, end }, text: commit }]);
            if (this.triggerCharacters().includes(commit)) {
                this.beginRequest({ triggerKind: 2, triggerCharacter: commit }, 0);
            }
        }
        editor.focus();
    }

    /*
     * Resolving gives the item its documentation and the import it needs, but only for the text it was
     * made for. When the person typed on since, the list is asked for again at the new text and the same
     * suggestion is resolved in that one; an item that cannot be resolved is still inserted as it is.
     */
    private async resolveNow(item: CompletionItem): Promise<CompletionItem> {
        const { editor, project, uri } = this.language;
        try {
            return await project.service.resolveCompletion(uri, item);
        } catch (error) {
            if (!(error instanceof StaleResultError)) {
                return item;
            }
        }
        try {
            const fresh = itemsOf(await project.service.completion(uri, editor.getCaret(), { triggerKind: 1 })).items.find(
                (candidate) => candidate.label === item.label && candidate.kind === item.kind
            );
            return fresh === undefined ? item : await project.service.resolveCompletion(uri, fresh).catch(() => fresh);
        } catch {
            return item;
        }
    }

    close(): void {
        this.request++;
        this.controller?.abort();
        this.timers.clear(this.requestTimer);
        this.timers.clear(this.refreshTimer);
        this.timers.clear(this.resolveTimer);
        this.pool = [];
        this.ranked = [];
        this.touched = false;
        this.explicit = false;
        this.activeKey = null;
        this.start = null;
        this.resolved.clear();
        if (this.language.popups.getState().completion !== null) {
            this.language.popups.setState({ completion: null });
        }
    }

    private key(event: KeyboardEvent): boolean {
        if (event.key === ' ' && event.ctrlKey && !event.shiftKey && !event.metaKey && !event.altKey) {
            if (this.isOpen) {
                this.detailsOpen = !this.detailsOpen;
                this.publish();
            } else {
                this.invoke();
            }
            return true;
        }
        if (!this.isOpen || event.ctrlKey || event.metaKey || event.altKey) {
            return false;
        }
        if (this.commits(event)) {
            void this.accept(false, this.active, event.key);
            return true;
        }
        switch (event.key) {
            case 'ArrowDown':
                this.move(1);
                return true;
            case 'ArrowUp':
                this.move(-1);
                return true;
            case 'PageDown':
                this.move(PAGE);
                return true;
            case 'PageUp':
                this.move(-PAGE);
                return true;
            case 'Enter':
            case 'Tab':
                if (event.shiftKey) {
                    return false;
                }
                void this.accept(event.key === 'Tab');
                return true;
            case 'Escape':
                this.close();
                return true;
            default:
                return false;
        }
    }

    /* A character the active item commits on, typed once the person has moved in the list or asked for it, which is when Enter would not be the way they chose. */
    private commits(event: KeyboardEvent): boolean {
        if ((!this.touched && !this.explicit) || event.key.length !== 1 || event.isComposing) {
            return false;
        }
        return this.ranked[this.active]?.item.commitCharacters?.includes(event.key) === true;
    }

    private edited(change: EditorTextChange): void {
        if (change.source !== 'input' || change.changes.length !== 1) {
            this.close();
            return;
        }
        const { range, text } = change.changes[0]!;
        const triggers = this.triggerCharacters();
        const last = Array.from(text).at(-1) ?? '';
        const typedIdentifier = text !== '' && Array.from(text).every(isIdentifierCharacter);
        if (text.length > 0 && triggers.includes(last) && text.length === 1) {
            this.close();
            this.beginRequest({ triggerKind: 2, triggerCharacter: last }, 0);
        } else if (this.isOpen) {
            if (text === '' || typedIdentifier) {
                this.refilter();
                this.scheduleRefresh();
            } else {
                this.close();
            }
        } else if (text.length === 1 && typedIdentifier && isEmpty(range)) {
            this.beginRequest({ triggerKind: 1 }, START_DELAY_MS);
        }
    }

    private caretMoved(position: EditorPosition): void {
        if (this.start === null) {
            return;
        }
        if (position.line !== this.start.line || position.character < this.start.character) {
            this.close();
        } else {
            this.refilter();
        }
    }

    private triggerCharacters(): readonly string[] {
        const { project, uri } = this.language;
        return project.service.providerOptions(METHOD, uri)?.triggerCharacters ?? [];
    }

    private scheduleRefresh(): void {
        const { project, uri } = this.language;
        this.timers.clear(this.refreshTimer);
        if (this.start === null || !project.service.supports(METHOD, uri)) {
            return;
        }
        const request = this.request;
        this.refreshTimer = this.timers.set(() => {
            if (request === this.request && this.start !== null) {
                void this.ask({ triggerKind: 1 }, request, true);
            }
        }, REFRESH_DELAY_MS);
    }

    private beginRequest(context: CompletionContext, delay: number): void {
        const { project, uri } = this.language;
        if (!project.service.supports(METHOD, uri)) {
            return;
        }
        this.timers.clear(this.requestTimer);
        const request = ++this.request;
        this.requestTimer = this.timers.set(() => void this.ask(context, request), delay);
    }

    private async ask(context: CompletionContext, request: number, refresh = false): Promise<void> {
        const { editor, project, uri } = this.language;
        const position = editor.getCaret();
        this.controller?.abort();
        const controller = new AbortController();
        this.controller = controller;
        let result;
        try {
            result = await project.service.completion(uri, position, context, { signal: controller.signal });
        } catch {
            return;
        }
        if (request !== this.request) {
            return;
        }
        const { items, incomplete } = itemsOf(result);
        this.pool = items;
        this.incomplete = incomplete;
        this.resolved.clear();
        this.server = project.service.serversOf(uri)[0] ?? '';
        if (!refresh) {
            const caret = editor.getCaret();
            const lineBefore = editor.textInRange({ start: { line: caret.line, character: 0 }, end: caret });
            const prefix = context.triggerKind === 2 ? '' : identifierPrefix(lineBefore);
            this.start = { line: caret.line, character: caret.character - prefix.length };
            this.active = 0;
            this.touched = false;
        } else if (this.touched && this.ranked[this.active] !== undefined) {
            // The list is made again, so the row that was chosen is found again by what it says.
            this.activeKey = RecentChoices.keyOf(this.ranked[this.active]!.item);
        }
        const asked = this.explicit && !refresh;
        this.refilter();
        if (asked && !this.isOpen && !this.incomplete) {
            useToasts.getState().show({ id: TOAST_ID, kind: 'error', title: i18next.t('panels:language.completion.none') });
        } else if (asked && this.ranked.length === 1 && !this.incomplete) {
            // One answer to a list that was asked for is the one wanted.
            void this.accept(false, 0);
        }
    }

    private refilter(): void {
        const { editor } = this.language;
        const caret = editor.getCaret();
        if (this.start === null || caret.line !== this.start.line || caret.character < this.start.character) {
            this.close();
            return;
        }
        const lineBefore = editor.textInRange({ start: { line: caret.line, character: 0 }, end: caret });
        const textBetween = (range: EditorRange): string => editor.textInRange(range);
        const before = this.ranked[this.active]?.item;
        const recent = recentChoicesOf(this.language.languageId);
        this.ranked = rankCompletions(
            this.pool,
            (item) => prefixFor(item, caret, lineBefore, textBetween),
            (item) => recent.recency(item)
        );
        if (this.ranked.length === 0) {
            if (this.incomplete && this.pool.length > 0) {
                this.beginRequest({ triggerKind: 3 }, START_DELAY_MS);
            }
            this.close();
            return;
        }
        const key = this.activeKey ?? (this.touched && before !== undefined ? RecentChoices.keyOf(before) : null);
        this.activeKey = null;
        const kept = key === null ? -1 : this.ranked.findIndex((entry) => RecentChoices.keyOf(entry.item) === key);
        this.active = kept >= 0 ? kept : 0;
        this.touched = this.touched && kept >= 0;
        this.publish();
        this.scheduleResolve();
        if (this.incomplete) {
            this.beginRequest({ triggerKind: 3 }, START_DELAY_MS);
        }
    }

    private scheduleResolve(): void {
        const { project, uri } = this.language;
        this.timers.clear(this.resolveTimer);
        const entry = this.ranked[this.active];
        if (entry === undefined || this.resolved.has(entry.item) || project.service.providerOptions('completionItem/resolve', uri) === undefined) {
            return;
        }
        this.resolveTimer = this.timers.set(() => {
            void project.service
                .resolveCompletion(uri, entry.item)
                .then((item) => {
                    this.resolved.set(entry.item, item);
                    if (this.ranked[this.active]?.item === entry.item) {
                        this.publish();
                    }
                })
                .catch(() => undefined);
        }, RESOLVE_DELAY_MS);
    }

    private publish(): void {
        const entry = this.ranked[this.active];
        if (entry === undefined || this.start === null) {
            return;
        }
        const item = this.resolved.get(entry.item) ?? entry.item;
        const descriptions = qualifiersOf(this.ranked.map((ranked) => ranked.item));
        const rows: CompletionRow[] = this.ranked.map(({ item: row, prefix }, index) => ({
            label: row.label,
            kind: row.kind,
            detail: row.labelDetails?.detail ?? '',
            description: descriptions[index]!,
            matches: matchedCharacters(row.label, prefix),
            deprecated: row.deprecated === true || row.tags?.includes(1) === true
        }));
        const highlightLanguage = shikiLanguageOf(this.language.languageId);
        const view: CompletionView = {
            anchor: this.start,
            rows,
            active: this.active,
            detailsOpen: this.detailsOpen,
            docs: completionDocsOf(item, highlightLanguage),
            server: this.server,
            highlightLanguage
        };
        this.language.popups.setState({ completion: view });
    }
}

import i18next from 'i18next';
import { StaleResultError, type Location, type Range } from '@ruimte/smart-editor-lsp';
import type { EditorPosition } from '@ruimte/smart-editor';
import { CANVAS_SHORTCUTS } from '@/canvas/shortcuts';
import { useToasts } from '@/state/toasts';
import type { EditorLanguage } from './editor-language';
import { uniquePlaces } from './navigation';
import { PEEK_READ_FILES, definitionSnippetOf, peekFilesOf, snippetOf, type PeekFile } from './peek-model';
import type { PeekView } from './popups';
import { isShortcut } from './shortcut-keys';

const TOAST_ID = 'language-peek';
/* Tall enough for the code and the list, until the editor has measured it. */
export const PEEK_HEIGHT = 300;

type PeekKind = PeekView['kind'];

const KINDS = {
    references: { method: 'textDocument/references', unavailable: 'unavailable', none: 'none' },
    definitions: { method: 'textDocument/definition', unavailable: 'unavailableDefinition', none: 'noDefinition' }
} as const;

function placeKey(location: Location): string {
    return `${location.uri}\0${location.range.start.line}\0${location.range.start.character}`;
}

function say(key: string, options?: Record<string, unknown>): string {
    return i18next.t(`panels:language.peek.${key}`, options);
}

/*
 * The references of the name at the caret, between the lines of the file under the line it is on. The
 * editor keeps the keyboard: arrows pick a reference, Enter goes to it and Escape closes the peek; typing
 * closes it too. A click on a place shows its code and a second one goes there.
 */
export class PeekFeature {
    private readonly language: EditorLanguage;
    private kind: PeekKind = 'references';
    /* The whole declaration of each place of a definition peek, where the server gave it. */
    private targets = new Map<string, Range>();
    private texts = new Map<string, string>();
    private places = new Map<string, Location>();
    private order: string[] = [];
    private line = 0;
    private token = 0;

    constructor(language: EditorLanguage) {
        this.language = language;
        const { editor } = language;
        const offs = [
            editor.onKeyDown((event) => {
                if (isShortcut(CANVAS_SHORTCUTS.peekReferences, event)) {
                    void this.open();
                    return true;
                }
                if (isShortcut(CANVAS_SHORTCUTS.peekDefinition, event)) {
                    void this.openDefinition();
                    return true;
                }
                return this.key(event);
            }),
            editor.onTextChange(() => this.close())
        ];
        language.onDispose(() => {
            for (const off of offs) {
                off();
            }
            this.close();
        });
    }

    get isOpen(): boolean {
        return this.language.popups.getState().peek !== null;
    }

    async open(position: EditorPosition = this.language.editor.getCaret(), kind: PeekKind = 'references'): Promise<void> {
        const { editor, project, uri } = this.language;
        const method = KINDS[kind].method;
        if (!project.service.supports(method, uri)) {
            this.tell(say(KINDS[kind].unavailable));
            return;
        }
        const token = ++this.token;
        let found: { locations: Location[]; targets: Map<string, Range> };
        try {
            found = await this.fetch(kind, position);
        } catch (error) {
            if (!(error instanceof StaleResultError)) {
                this.tell(say('failed', { message: error instanceof Error ? error.message : String(error) }));
            }
            return;
        }
        if (token !== this.token) {
            return;
        }
        const { targets } = found;
        const unique = found.locations.filter(
            (location, index) =>
                found.locations.findIndex(
                    (other) =>
                        other.uri === location.uri &&
                        other.range.start.line === location.range.start.line &&
                        other.range.start.character === location.range.start.character
                ) === index
        );
        if (unique.length === 0) {
            this.tell(say(KINDS[kind].none));
            return;
        }
        const uris = [...new Set(unique.map((location) => location.uri))].slice(0, PEEK_READ_FILES);
        const texts = new Map<string, string>();
        await Promise.all(
            uris.map(async (target) => {
                const text = await project.readText(target);
                if (text !== null) {
                    texts.set(target, text);
                }
            })
        );
        if (token !== this.token) {
            return;
        }
        this.texts = texts;
        this.kind = kind;
        this.targets = targets;
        const files = peekFilesOf(unique, uri, (target) => texts.get(target) ?? null);
        this.places = new Map(files.flatMap((file: PeekFile) => file.places.map((place) => [place.id, place.location] as const)));
        this.order = files.flatMap((file) => file.places.map((place) => place.id));
        // The references open on the first place that is not the one the caret is on, which is what a person came to see.
        const first =
            kind === 'definitions'
                ? files[0]!.places[0]!
                : (files.flatMap((file) => file.places).find((place) => !(place.location.uri === uri && place.line === position.line)) ?? files[0]!.places[0]!);
        this.line = position.line;
        this.language.popups.setState({ peek: { kind, container: null, files, active: first.id, count: unique.length, preview: null } });
        this.select(first.id);
        editor.setWidgets([{ id: 'peek', line: this.line, height: PEEK_HEIGHT, render: (container) => this.mounted(container) }]);
        // The keys come through the editor, which a click on the hover's link or a menu command has taken the focus from.
        editor.focus();
    }

    /* The definition of the name at the caret, as its source between the lines of the file. */
    openDefinition(position: EditorPosition = this.language.editor.getCaret()): Promise<void> {
        return this.open(position, 'definitions');
    }

    private async fetch(kind: PeekKind, position: EditorPosition): Promise<{ locations: Location[]; targets: Map<string, Range> }> {
        const { project, uri } = this.language;
        if (kind === 'references') {
            return { locations: (await project.service.references(uri, position, true)) ?? [], targets: new Map() };
        }
        const places = uniquePlaces(await project.service.definition(uri, position));
        const targets = new Map(places.flatMap(({ location, target }) => (target === null ? [] : [[placeKey(location), target] as const])));
        return { locations: places.map(({ location }) => location), targets };
    }

    close(): void {
        this.token++;
        if (this.language.popups.getState().peek === null) {
            return;
        }
        this.language.popups.setState({ peek: null });
        this.language.editor.setWidgets([]);
        this.language.editor.focus();
    }

    /* Shows the code around a place. */
    select(id: string): void {
        const view = this.language.popups.getState().peek;
        const location = this.places.get(id);
        if (view === null || location === undefined) {
            return;
        }
        const text = this.texts.get(location.uri);
        const line = location.range.start.line;
        const snippet =
            text === undefined
                ? null
                : this.kind === 'definitions'
                  ? definitionSnippetOf(text, line, this.targets.get(placeKey(location)) ?? null)
                  : snippetOf(text, line);
        this.language.popups.setState({ peek: { ...view, active: id, preview: snippet === null ? null : { ...snippet, uri: location.uri } } });
    }

    /* Goes to a place and closes the peek. */
    go(id: string): void {
        const location = this.places.get(id);
        if (location !== undefined) {
            this.close();
            this.language.goTo(location);
        }
    }

    private mounted(container: HTMLElement): void {
        const view = this.language.popups.getState().peek;
        if (view !== null && view.container !== container) {
            this.language.popups.setState({ peek: { ...view, container } });
        }
    }

    private key(event: KeyboardEvent): boolean {
        const view = this.language.popups.getState().peek;
        if (view === null || event.metaKey || event.ctrlKey || event.altKey) {
            return false;
        }
        const index = this.order.indexOf(view.active);
        switch (event.key) {
            case 'ArrowDown':
                this.select(this.order[Math.min(this.order.length - 1, index + 1)]!);
                return true;
            case 'ArrowUp':
                this.select(this.order[Math.max(0, index - 1)]!);
                return true;
            case 'Enter':
                this.go(view.active);
                return true;
            case 'Escape':
                this.close();
                return true;
            default:
                return false;
        }
    }

    private tell(title: string): void {
        useToasts.getState().show({ id: TOAST_ID, kind: 'error', title });
    }
}

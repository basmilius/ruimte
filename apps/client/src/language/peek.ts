import i18next from 'i18next';
import { StaleResultError, type Location } from '@ruimte/smart-editor-lsp';
import type { EditorPosition } from '@ruimte/smart-editor';
import { CANVAS_SHORTCUTS } from '@/canvas/shortcuts';
import { useToasts } from '@/state/toasts';
import type { EditorLanguage } from './editor-language';
import { PEEK_READ_FILES, peekFilesOf, snippetOf, type PeekFile } from './peek-model';
import { isShortcut } from './shortcut-keys';

const METHOD = 'textDocument/references';
const TOAST_ID = 'language-peek';
/* Tall enough for the code and the list, until the editor has measured it. */
export const PEEK_HEIGHT = 300;

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

    async open(position: EditorPosition = this.language.editor.getCaret()): Promise<void> {
        const { editor, project, uri } = this.language;
        if (!project.service.supports(METHOD, uri)) {
            this.tell(say('unavailable'));
            return;
        }
        const token = ++this.token;
        let locations: Location[] | null;
        try {
            locations = await project.service.references(uri, position, true);
        } catch (error) {
            if (!(error instanceof StaleResultError)) {
                this.tell(say('failed', { message: error instanceof Error ? error.message : String(error) }));
            }
            return;
        }
        if (token !== this.token) {
            return;
        }
        if (locations === null || locations.length === 0) {
            this.tell(say('none'));
            return;
        }
        const unique = locations.filter(
            (location, index) =>
                locations!.findIndex(
                    (other) =>
                        other.uri === location.uri &&
                        other.range.start.line === location.range.start.line &&
                        other.range.start.character === location.range.start.character
                ) === index
        );
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
        const files = peekFilesOf(unique, uri, (target) => texts.get(target) ?? null);
        this.places = new Map(files.flatMap((file: PeekFile) => file.places.map((place) => [place.id, place.location] as const)));
        this.order = files.flatMap((file) => file.places.map((place) => place.id));
        // Open on the first place that is not the one the caret is on, which is what a person came to see.
        const first =
            files.flatMap((file) => file.places).find((place) => !(place.location.uri === uri && place.line === position.line)) ?? files[0]!.places[0]!;
        this.line = position.line;
        this.language.popups.setState({ peek: { container: null, files, active: first.id, count: unique.length, preview: null } });
        this.select(first.id);
        editor.setWidgets([{ id: 'peek', line: this.line, height: PEEK_HEIGHT, render: (container) => this.mounted(container) }]);
        // The keys come through the editor, which a click on the hover's link or a menu command has taken the focus from.
        editor.focus();
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
        this.language.popups.setState({
            peek: { ...view, active: id, preview: text === undefined ? null : { ...snippetOf(text, location.range.start.line), uri: location.uri } }
        });
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

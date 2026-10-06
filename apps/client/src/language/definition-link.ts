import type { EditorPosition } from '@adecore/editor';
import { isApplePlatform } from '@/desktop/bridge';
import { isIdentifierCharacter } from './completion-model';
import type { EditorLanguage } from './editor-language';
import { locationsOf } from './hover-content';
import { wordRangeAt } from './rename-model';

/*
 * The name under the pointer drawn as a link while Cmd (Ctrl elsewhere) is held and a server knows where it
 * is defined, which is what a Mod+click on it follows. The editor only says where the pointer is, so the
 * key comes from the window.
 */
export class DefinitionLinkFeature {
    private readonly language: EditorLanguage;
    private held = false;
    private pointer: EditorPosition | null = null;
    private shownKey = '';
    private drawn = false;
    private request = 0;
    private lookup: AbortController | null = null;

    constructor(language: EditorLanguage) {
        this.language = language;
        const { editor } = language;
        const offs = [
            editor.onHover((hover) => {
                this.pointer = hover?.position ?? null;
                this.update();
            }),
            editor.onTextChange(() => this.clear()),
            editor.onViewChange(() => this.clear())
        ];
        if (typeof window !== 'undefined') {
            const modKey = isApplePlatform() ? 'Meta' : 'Control';
            const keys = (event: KeyboardEvent): void => {
                if (event.key === modKey) {
                    this.setModHeld(event.type === 'keydown');
                }
            };
            const lost = (): void => this.setModHeld(false);
            window.addEventListener('keydown', keys);
            window.addEventListener('keyup', keys);
            window.addEventListener('blur', lost);
            offs.push(() => {
                window.removeEventListener('keydown', keys);
                window.removeEventListener('keyup', keys);
                window.removeEventListener('blur', lost);
            });
        }
        language.onDispose(() => {
            for (const off of offs) {
                off();
            }
            this.clear();
        });
    }

    setModHeld(held: boolean): void {
        if (held !== this.held) {
            this.held = held;
            this.update();
        }
    }

    private clear(): void {
        this.request++;
        this.lookup?.abort();
        this.shownKey = '';
        if (this.drawn) {
            this.drawn = false;
            this.language.editor.setLink(null);
        }
    }

    private update(): void {
        const { pointer } = this;
        if (!this.held || pointer === null || !this.language.project.service.supports('textDocument/definition', this.language.uri)) {
            this.clear();
            return;
        }
        const { editor, project, uri } = this.language;
        const line = editor.textInRange({ start: { line: pointer.line, character: 0 }, end: { line: pointer.line, character: Number.MAX_SAFE_INTEGER } });
        const word = isIdentifierCharacter(line[pointer.character] ?? '') ? wordRangeAt(line, pointer) : null;
        if (word === null) {
            this.clear();
            return;
        }
        const key = `${word.start.line}:${word.start.character}`;
        if (key === this.shownKey) {
            return;
        }
        this.clear();
        this.shownKey = key;
        const request = ++this.request;
        const controller = new AbortController();
        this.lookup = controller;
        project.service
            .definition(uri, pointer, { signal: controller.signal })
            .then((result) => {
                if (request === this.request && locationsOf(result).length > 0) {
                    this.drawn = true;
                    editor.setLink(word);
                }
            })
            .catch(() => undefined);
    }
}

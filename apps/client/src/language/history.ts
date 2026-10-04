import i18next from 'i18next';
import { CANVAS_SHORTCUTS } from '@/canvas/shortcuts';
import type { EditorLanguage } from './editor-language';
import { isShortcut } from './shortcut-keys';

/* Back, Forward and the list of recent locations over the history the whole project shares. */
export class HistoryFeature {
    private readonly language: EditorLanguage;

    constructor(language: EditorLanguage) {
        this.language = language;
        const off = language.editor.onKeyDown((event) => {
            if (isShortcut(CANVAS_SHORTCUTS.historyBack, event)) {
                this.back();
                return true;
            }
            if (isShortcut(CANVAS_SHORTCUTS.historyForward, event)) {
                this.forward();
                return true;
            }
            if (isShortcut(CANVAS_SHORTCUTS.recentLocations, event)) {
                this.recent();
                return true;
            }
            return false;
        });
        language.onDispose(off);
    }

    /* Returns to where the caret was before the last jump; false when there is no such place. */
    back(): boolean {
        const place = this.language.project.history.back(this.language.place);
        if (place === null) {
            return false;
        }
        this.language.visit(place);
        return true;
    }

    forward(): boolean {
        const place = this.language.project.history.forward(this.language.place);
        if (place === null) {
            return false;
        }
        this.language.visit(place);
        return true;
    }

    /* Lists the places of the history under the caret; choosing one jumps there like any other jump. */
    recent(): void {
        const places = this.language.project.history.recent(this.language.place);
        this.language.locations(
            places.map((place) => ({ uri: place.uri, range: { start: place.position, end: place.position } })),
            this.language.editor.getCaret(),
            i18next.t('panels:language.history.recent')
        );
    }
}

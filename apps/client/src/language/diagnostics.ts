import type { Diagnostic } from '@ruimte/smart-editor-lsp';
import type { EditorContentChange, EditorPosition } from '@ruimte/smart-editor';
import type { EditorLanguage } from './editor-language';
import { markerOf, neighborProblem, problemsAt, shiftRange, type Problem } from './diagnostics-model';

export interface ProblemCounts {
    readonly error: number;
    readonly warning: number;
    readonly info: number;
}

/*
 * The problems the servers report for one file. A report from a server replaces the one before it
 * from the same server, the editor draws them, and each one follows its text through edits made
 * before the server reports again, so what is under a squiggle is still what it was about.
 */
export class DiagnosticsFeature {
    private readonly language: EditorLanguage;
    private readonly reports = new Map<string, readonly Diagnostic[]>();
    private readonly listeners = new Set<() => void>();
    private list: readonly Problem[] = [];

    constructor(language: EditorLanguage) {
        this.language = language;
        const { editor, project, uri } = language;
        const reports = project.service.onDiagnostics((report) => {
            if (report.uri === uri) {
                this.reports.set(report.source, report.diagnostics);
                this.rebuild(true);
            }
        });
        const edits = editor.onTextChange((change) => this.shift(change.changes));
        // Alt+F8 and Alt+Shift+F8 are the editor's while it has the keyboard; elsewhere the menu's commands answer.
        const keys = editor.onKeyDown((event) => {
            if (event.key !== 'F8' || !event.altKey || event.metaKey || event.ctrlKey) {
                return false;
            }
            this.step(event.shiftKey ? -1 : 1);
            return true;
        });
        language.onDispose(() => {
            keys();
            reports.dispose();
            edits();
            this.listeners.clear();
            editor.setMarkers([]);
        });
    }

    get problems(): readonly Problem[] {
        return this.list;
    }

    counts(): ProblemCounts {
        const count = (severity: number): number => this.list.filter((problem) => (problem.diagnostic.severity ?? 1) === severity).length;
        return { error: count(1), warning: count(2), info: count(3) };
    }

    at(position: EditorPosition): Problem[] {
        return problemsAt(this.list, position);
    }

    /* Puts the caret on the next problem, or the one before; false when there is none. */
    step(direction: 1 | -1): boolean {
        const { editor } = this.language;
        const target = neighborProblem(this.list, editor.getCaret(), direction);
        if (target === null) {
            return false;
        }
        editor.setCaret(target.diagnostic.range.start);
        editor.focus();
        this.language.hover.showProblemsAt(editor.getCaret());
        return true;
    }

    /* Puts the caret on the first problem of the file. */
    goToFirst(): boolean {
        const { editor } = this.language;
        const target = neighborProblem(this.list, { line: -1, character: 0 }, 1);
        if (target === null) {
            return false;
        }
        editor.setCaret(target.diagnostic.range.start);
        editor.focus();
        this.language.hover.showProblemsAt(editor.getCaret());
        return true;
    }

    onChange(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    private shift(changes: readonly EditorContentChange[]): void {
        for (const [server, diagnostics] of this.reports) {
            this.reports.set(
                server,
                diagnostics.map((diagnostic) => ({ ...diagnostic, range: shiftRange(diagnostic.range, changes) }))
            );
        }
        this.rebuild(false);
    }

    private rebuild(draw: boolean): void {
        this.list = [...this.reports].flatMap(([server, diagnostics]) => diagnostics.map((diagnostic): Problem => ({ diagnostic, server })));
        if (draw) {
            this.language.editor.setMarkers(this.list.map((problem) => markerOf(problem.diagnostic)));
        }
        for (const listener of [...this.listeners]) {
            listener();
        }
    }
}

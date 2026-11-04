import type { Editor, EditorEngine, EditorIndentation } from '@adecore/editor';
import { forgetMovesFrom, openingPlace, viewStateKey, viewStates } from '@adecore/editor-react';
import i18next from 'i18next';
import { type RefObject, useEffect, useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { mountDraftEditor } from '@/shell/panels/draft-editor';
import { revealLocation } from '@/shell/panels/reveal-location';
import { foldRolesFor } from '@/state/code-folding';
import { useCodeTheme } from '@/state/code-theme';
import type { RevealLineRequest } from '@/state/files';
import { endpointKey } from '@/state/keys';
import { useLoadedFaces, useSettings } from '@/state/settings';
import { type DiskText, textDrafts } from '@/state/text-drafts';

type EditorSetter =
    | 'setTheme'
    | 'setLabel'
    | 'setWrap'
    | 'setIndentation'
    | 'setSmartKeys'
    | 'setGuides'
    | 'setWhitespace'
    | 'setStickyScroll'
    | 'setFoldOutline'
    | 'setRightMargin'
    | 'setFontSize';

/* Hands a value the editor mounted with to it again whenever it changes. */
function useEditorSetting<Setter extends EditorSetter>(
    editor: RefObject<Editor | null>,
    setter: Setter,
    value: Parameters<NonNullable<Editor[Setter]>>[0]
): void {
    useEffect(() => {
        const target = editor.current;
        (target?.[setter] as ((next: typeof value) => void) | undefined)?.call(target, value);
    }, [editor, setter, value]);
}

interface FileEditorProps {
    engine: EditorEngine;
    endpointId: string;
    /* Absolute on the daemon's machine. */
    path: string;
    /* What the file read as, which the draft starts from when there is none yet. */
    disk: DiskText;
    /* Undefined for plain text, which is also every file too long to color. */
    language: string | undefined;
    wrap: boolean;
    indentation: EditorIndentation;
    /* The column the project holds lines to, drawn as a line; null for none. */
    rightMargin: number | null;
    /* Why the file cannot be edited here, null when it can. */
    readOnlyReason: string | null;
    /* Where the placeholder was scrolled to when the editor took over, so nothing moves. */
    placeholderScroll: RefObject<number>;
    /* Whether the node it sits in has the keyboard; null outside a node, where only a click gives it. */
    focused: boolean | null;
    reveal: RevealLineRequest | null;
    /* The editor once it is mounted, and null once it is gone, for what drives it from outside, such as the find bar. */
    onEditor?(editor: Editor | null): void;
}

/*
 * The file as an editor. Its text is the file's one draft, so another surface on the same file types
 * into the same text, and leaving it saves.
 */
export function FileEditor({
    engine,
    endpointId,
    path,
    disk,
    language,
    wrap,
    indentation,
    rightMargin,
    readOnlyReason,
    placeholderScroll,
    focused,
    reveal,
    onEditor
}: FileEditorProps) {
    const { t } = useTranslation('panels');
    const label = t('file.edit.label', { path });
    const host = useRef<HTMLDivElement>(null);
    const editorRef = useRef<Editor | null>(null);
    const theme = useCodeTheme();
    const codeFontSize = useSettings((s) => s.codeFontSize);
    const codeLineHeight = useSettings((s) => s.codeLineHeight);
    const font = useSettings((s) => s.font);
    const codeLigatures = useSettings((s) => s.codeLigatures);
    const loadedFaces = useLoadedFaces((s) => s.count);
    const smartKeys = useSettings((s) => s.smartKeys);
    const guides = useSettings((s) => s.codeIndentGuides);
    const whitespace = useSettings((s) => s.codeWhitespace);
    const stickyScroll = useSettings((s) => s.codeStickyScroll);
    const folding = useSettings((s) => s.codeFolding);
    const foldOutline = useSettings((s) => s.codeFoldOutline);
    const zoom = useSettings((s) => s.codeZoom);
    // What the editor mounts with; every later change reaches it through the effects below.
    const initial = useRef({
        disk,
        label,
        language,
        wrap,
        indentation,
        rightMargin,
        guides,
        whitespace,
        stickyScroll,
        smartKeys,
        readOnlyReason,
        theme,
        reveal,
        folding,
        foldOutline,
        zoom
    });
    const revealed = useRef<number | null>(null);
    const readOnly = readOnlyReason !== null;

    useLayoutEffect(() => {
        const element = host.current;
        if (element === null) {
            return;
        }
        const first = initial.current;
        const key = endpointKey(endpointId, path);
        forgetMovesFrom(key);
        const { editor, unmount } = mountDraftEditor(
            engine,
            element,
            textDrafts,
            { endpointId, path, disk: first.disk },
            {
                ...(first.language === undefined ? {} : { language: first.language }),
                theme: first.theme,
                label: first.label,
                ...(first.readOnlyReason === null ? {} : { readOnly: true, readOnlyReason: first.readOnlyReason }),
                wrap: first.wrap,
                indentation: first.indentation,
                guides: first.guides,
                whitespace: first.whitespace,
                stickyScroll: first.stickyScroll,
                rightMargin: first.rightMargin,
                smartKeys: first.smartKeys,
                foldOutline: first.foldOutline,
                ...(first.zoom === null ? {} : { fontSize: first.zoom }),
                messages: { noMoreOccurrences: i18next.t('panels:file.edit.noMoreOccurrences') },
                ...openingPlace(first.reveal, viewStates.get(key), placeholderScroll.current, foldRolesFor(first.language, first.folding))
            }
        );
        revealed.current = first.reveal?.nonce ?? null;
        editorRef.current = editor;
        if (first.reveal !== null) {
            revealLocation(editor, first.reveal);
        }
        onEditor?.(editor);
        // A zoom is the client's, so every editor it has open follows the one a person zoomed.
        const offZoom = editor.onFontSizeChange?.((size) => useSettings.getState().update({ codeZoom: size }));
        return () => {
            offZoom?.();
            const caret = editor.getCaret();
            viewStates.set(viewStateKey(key), {
                scrollTop: editor.getScrollTop(),
                line: caret.line + 1,
                column: caret.character + 1,
                folds: editor.getFolds()
            });
            editorRef.current = null;
            onEditor?.(null);
            unmount();
        };
    }, [engine, endpointId, path, placeholderScroll, onEditor]);

    useEditorSetting(editorRef, 'setTheme', theme);
    useEditorSetting(editorRef, 'setLabel', label);
    useEditorSetting(editorRef, 'setWrap', wrap);
    useEditorSetting(editorRef, 'setIndentation', indentation);
    useEditorSetting(editorRef, 'setSmartKeys', smartKeys);
    useEditorSetting(editorRef, 'setGuides', guides);
    useEditorSetting(editorRef, 'setWhitespace', whitespace);
    useEditorSetting(editorRef, 'setStickyScroll', stickyScroll);
    useEditorSetting(editorRef, 'setFoldOutline', foldOutline);
    useEditorSetting(editorRef, 'setRightMargin', rightMargin);
    useEditorSetting(editorRef, 'setFontSize', zoom);

    // The settings wrote the tokens on the root before the store told anyone, so the editor reads the new face.
    useEffect(() => {
        editorRef.current?.refreshFont();
    }, [codeFontSize, codeLineHeight, font, codeLigatures, loadedFaces]);

    useEffect(() => {
        editorRef.current?.setReadOnly(readOnly, readOnlyReason ?? undefined);
    }, [readOnly, readOnlyReason]);

    useEffect(() => {
        if (reveal === null || reveal.nonce === revealed.current) {
            return;
        }
        revealed.current = reveal.nonce;
        if (editorRef.current) {
            revealLocation(editorRef.current, reveal);
        }
    }, [reveal]);

    /* A node's editor has the keyboard exactly while the node does, the way a terminal's does. */
    useEffect(() => {
        const editor = editorRef.current;
        if (editor === null || focused === null) {
            return;
        }
        if (focused && !readOnly) {
            editor.focus();
            return;
        }
        const active = document.activeElement;
        if (active instanceof HTMLElement && host.current?.contains(active)) {
            active.blur();
        }
    }, [focused, readOnly]);

    return <div ref={host} className="relative min-h-0 min-w-0 grow overflow-hidden" />;
}

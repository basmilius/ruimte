import { useEffect, useLayoutEffect, useRef } from 'react';
import type { Editor, EditorEngine } from '@ruimte/editor';
import { bindDraftEditor } from '@/shell/panels/draft-editor';
import type { RevealLineRequest } from '@/state/files';
import { type DiskText, textDrafts } from '@/state/text-drafts';
import { useTheme } from '@/state/theme';

/* Where a click in the viewer landed and where the viewer stood, so turning the editor on moves nothing. */
export interface EditStart {
    line: number;
    column: number;
    scrollTop: number;
}

interface FileEditorProps {
    engine: EditorEngine;
    endpointId: string;
    /* Absolute on the daemon's machine. */
    path: string;
    /* What the file read as, which the draft starts from when there is none yet. */
    disk: DiskText;
    language: string | undefined;
    wrap: boolean;
    readOnly: boolean;
    /* Null when the editor came up for a draft rather than for a click. */
    start: EditStart | null;
    /* Whether the node it sits in has the keyboard; null outside a node, where only a click gives it. */
    focused: boolean | null;
    reveal: RevealLineRequest | null;
}

/*
 * The file as an editor, in the place the viewer had. Its text is the file's one draft, so another
 * surface on the same file types into the same text, and leaving it saves.
 */
export function FileEditor({ engine, endpointId, path, disk, language, wrap, readOnly, start, focused, reveal }: FileEditorProps) {
    const host = useRef<HTMLDivElement>(null);
    const editorRef = useRef<Editor | null>(null);
    const theme = useTheme((s) => s.resolved);
    // What the editor mounts with; every later change reaches it through the effects below.
    const initial = useRef({ disk, language, wrap, readOnly, start, theme, focused });
    // A jump asked for before a click turned the editor on is behind the person already.
    const revealed = useRef(start === null ? null : (reveal?.nonce ?? null));

    useLayoutEffect(() => {
        const element = host.current;
        if (element === null) {
            return;
        }
        const first = initial.current;
        textDrafts.open(endpointId, path, first.disk);
        const editor = engine.mount(element, {
            text: textDrafts.draft(endpointId, path)?.text ?? first.disk.text,
            ...(first.language === undefined ? {} : { language: first.language }),
            theme: first.theme,
            readOnly: first.readOnly,
            wrap: first.wrap,
            ...(first.start ?? {})
        });
        const unbind = bindDraftEditor(editor, textDrafts, endpointId, path);
        editorRef.current = editor;
        if (first.start !== null && !first.readOnly && first.focused !== false) {
            editor.focus();
        }
        return () => {
            editorRef.current = null;
            unbind();
            editor.dispose();
            void textDrafts.save(endpointId, path);
        };
    }, [engine, endpointId, path]);

    useEffect(() => {
        editorRef.current?.setTheme(theme);
    }, [theme]);

    useEffect(() => {
        editorRef.current?.setWrap(wrap);
    }, [wrap]);

    useEffect(() => {
        editorRef.current?.setReadOnly(readOnly);
    }, [readOnly]);

    useEffect(() => {
        if (reveal === null || reveal.nonce === revealed.current) {
            return;
        }
        revealed.current = reveal.nonce;
        editorRef.current?.revealLine(reveal.line);
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

import { type RefObject, useEffect, useLayoutEffect, useRef } from 'react';
import type { Editor, EditorEngine } from '@ruimte/editor';
import { mountDraftEditor } from '@/shell/panels/draft-editor';
import { useCodeTheme } from '@/state/code-theme';
import type { RevealLineRequest } from '@/state/files';
import { type DiskText, textDrafts } from '@/state/text-drafts';

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
export function FileEditor({ engine, endpointId, path, disk, language, wrap, readOnlyReason, placeholderScroll, focused, reveal, onEditor }: FileEditorProps) {
    const host = useRef<HTMLDivElement>(null);
    const editorRef = useRef<Editor | null>(null);
    const theme = useCodeTheme();
    // What the editor mounts with; every later change reaches it through the effects below.
    const initial = useRef({ disk, language, wrap, readOnlyReason, theme, reveal });
    const revealed = useRef<number | null>(null);
    const readOnly = readOnlyReason !== null;

    useLayoutEffect(() => {
        const element = host.current;
        if (element === null) {
            return;
        }
        const first = initial.current;
        const { editor, unmount } = mountDraftEditor(
            engine,
            element,
            textDrafts,
            { endpointId, path, disk: first.disk },
            {
                ...(first.language === undefined ? {} : { language: first.language }),
                theme: first.theme,
                ...(first.readOnlyReason === null ? {} : { readOnly: true, readOnlyReason: first.readOnlyReason }),
                wrap: first.wrap,
                ...(first.reveal === null ? { scrollTop: placeholderScroll.current } : { line: first.reveal.line })
            }
        );
        revealed.current = first.reveal?.nonce ?? null;
        editorRef.current = editor;
        onEditor?.(editor);
        return () => {
            editorRef.current = null;
            onEditor?.(null);
            unmount();
        };
    }, [engine, endpointId, path, placeholderScroll, onEditor]);

    useEffect(() => {
        editorRef.current?.setTheme(theme);
    }, [theme]);

    useEffect(() => {
        editorRef.current?.setWrap(wrap);
    }, [wrap]);

    useEffect(() => {
        editorRef.current?.setReadOnly(readOnly, readOnlyReason ?? undefined);
    }, [readOnly, readOnlyReason]);

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

import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { FS_READ_MAX_TEXT_BYTES, type FsReadText, type FileLocation } from '@ruimte/contracts';
import type { Editor } from '@adecore/editor';
import { FindBar } from '@/find/FindBar';
import { registerFocusedLanguage } from '@/language/focused-language';
import { registerFocusedEditor } from '@/shell/panels/focused-editor';
import { LanguagePopups } from '@/language/RuimteLanguagePopups';
import { useFind } from '@/find/use-find';
import { formatBytes, formatNumber } from '@adecore/ui/format';
import { Button, ErrorBoundary, lazyNamed, Pill, Tooltip } from '@adecore/ui';
import { isSqlPath } from '@/database/console-file';
import { DraftBar, EditorNotice } from '@/shell/panels/DraftBar';
import type { EditBlock } from '@/shell/panels/edit-gate';
import { useFileActions } from '@/shell/panels/file-actions';
import { EditorStatusBar } from '@/shell/panels/EditorStatusBar';
import { FileEditor } from '@/shell/panels/FileEditor';
import { FileScroll } from '@/shell/panels/FileScroll';
import { FileToolbar } from '@/shell/panels/FileToolbar';
import { FileBreadcrumb } from '@/shell/panels/FileBreadcrumb';
import { highlightDocument } from '@/shell/panels/highlight';
import { lineEndingOf } from '@/shell/panels/status-bar-model';
import { editorSeed, useEditorFind } from '@/shell/panels/use-editor-find';
import { useEditorLanguage } from '@/shell/panels/use-editor-language';
import { useChangeMarks } from '@/shell/panels/use-change-marks';
import { AgentEditingChip } from '@/editor-ai/AgentEditingChip';
import { ProvenanceCard } from '@/editor-ai/ProvenanceCard';
import { ConflictLayer } from '@/editor-ai/ConflictLayer';
import { ReviewBar, ReviewLayer } from '@/editor-ai/ReviewLayer';
import { useAgentChanges } from '@/editor-ai/use-agent-changes';
import { useConflictResolution } from '@/editor-ai/use-conflict-resolution';
import { useCodeVision } from '@/shell/panels/use-code-vision';
import { useGitBlame } from '@/shell/panels/use-git-blame';
import { useEditorScope } from '@/shell/panels/use-editor-scope';
import { useFileEditing } from '@/shell/panels/use-file-editing';
import { useGitBase } from '@/shell/panels/use-git-base';
import { useCodeTheme } from '@/state/code-theme';
import { fileTabOf, useFiles } from '@/state/files';
import { shownFolderOf, useProject } from '@/state/project';
import { useSettings } from '@/state/settings';

const SqlConsole = lazyNamed(() => import('@/database/SqlConsole'), 'SqlConsole');

const SqlBindingPicker = lazyNamed(() => import('@/database/SqlBindingPicker'), 'SqlBindingPicker');

// One screen of code, near enough. Small enough to highlight without a stutter, large enough that a
// long file is a handful of blocks instead of thousands.
const CHUNK_LINES = 400;

// How far outside the viewport a chunk starts drawing itself, so scrolling never waits for it.
const LOOK_AHEAD = '600px';

// How long the line a link asked for stays marked. Long enough to find it, short enough to forget.
const FLASH_MS = 1600;

/*
 * Past this a file is plain text and read only, in the viewer and the editor alike. A generated file
 * of a hundred thousand lines is one nobody reads for its colors, and the editor would color all of it
 * in the background.
 */
const HIGHLIGHT_MAX_LINES = 20000;

interface ChunkProps {
    code: string;
    lines: number;
    /* The line number this chunk opens on, one-based. */
    start: number;
    /* Null in a file too long to highlight, which draws as the plain text it falls back to anyway. */
    language: string | null;
    /* A Shiki theme id. */
    theme: string;
    /* The line this chunk was asked to bring into view, one-based, when the ask landed in it. */
    reveal?: Omit<FileLocation, 'path'>;
    /* Which ask that was, so the same line twice jumps twice. */
    revealNonce?: number;
}

/*
 * A block of the file. It draws nothing until it comes near the viewport, then plain text, then the
 * highlighted version once shiki answers. Every step has the same line count and line height, so the
 * page below it never moves.
 */
function CodeChunk({ code, lines, start, language, theme, reveal, revealNonce }: ChunkProps) {
    const ref = useRef<HTMLDivElement>(null);
    const [seen, setSeen] = useState(start === 1);
    const [html, setHtml] = useState<string | null>(null);
    // A chunk the viewport never reached still draws itself when a link points into it.
    const near = seen || reveal !== undefined;
    const revealLine = reveal?.line;
    const revealEndLine = reveal?.endLine ?? revealLine;

    /*
     * The line is a DOM node either way: plain text draws it as a React child, shiki hands back
     * markup this component only sets. Marking it from the outside is what works for both, and the
     * effect runs again when the highlighted version replaces the plain one under it.
     */
    useEffect(() => {
        const element = ref.current;
        if (revealLine === undefined || !near || !element) {
            return;
        }
        const marked = Array.from(element.querySelectorAll('.line')).filter(
            (_, index) => start + index >= revealLine && start + index <= (revealEndLine ?? revealLine)
        );
        if (revealLine >= start) {
            marked[0]?.scrollIntoView({ block: 'center' });
        }
        marked.forEach((line) => line.classList.add('is-revealed'));
        const clear = (): void => marked.forEach((line) => line.classList.remove('is-revealed'));
        const timer = setTimeout(clear, FLASH_MS);
        return () => {
            clearTimeout(timer);
            clear();
        };
    }, [revealLine, revealEndLine, revealNonce, near, html, start]);

    useEffect(() => {
        const element = ref.current;
        if (near || !element) {
            return;
        }
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) {
                    setSeen(true);
                }
            },
            { rootMargin: LOOK_AHEAD }
        );
        observer.observe(element);
        return () => observer.disconnect();
    }, [near]);

    useEffect(() => {
        if (!near || language === null) {
            return;
        }
        let cancelled = false;
        highlightDocument(code, language, theme)
            .then((result) => {
                if (!cancelled) {
                    setHtml(result);
                }
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [near, code, language, theme]);

    // The counter starts one line before the first, since every line increments it before it prints.
    // The height is reserved before the chunk draws, so the scrollbar is the right length from the first paint.
    const style = { counterReset: `line ${start - 1}`, minHeight: `calc(${lines} * var(--code-line-height))` };

    if (html !== null) {
        return <div ref={ref} className="file-code-chunk" data-start={start} style={style} dangerouslySetInnerHTML={{ __html: html }} />;
    }
    return (
        <div ref={ref} className="file-code-chunk" data-start={start} style={style}>
            <pre>
                <code>
                    {near &&
                        code.split('\n').map((line, index) => (
                            <span key={index} className="line">
                                {line}
                            </span>
                        ))}
                </code>
            </pre>
        </div>
    );
}

/* Why a file is read only, for the tooltip on the toolbar's pill and for typing into the editor anyway. */
const BLOCK_LABELS: Record<EditBlock, string> = {
    'outside-project': 'file.edit.outsideProject',
    'ruimte-state': 'file.edit.ruimteState',
    large: 'file.edit.large',
    plain: 'file.edit.plain',
    touch: 'file.edit.touch'
};

export interface CodeFileProps {
    /* Absolute on the daemon's machine. */
    path: string;
    read: FsReadText;
    /* Controls the file's own renderer adds to the toolbar, such as the markdown view switch. */
    toolbarExtra?: ReactNode;
}

/*
 * Any text file, as an editor. The viewer's chunks draw the same place while the editor loads, so nothing
 * moves when it takes over, and stay for a finger, which the editor has no touch handling for, and for an editor that
 * did not load. Where the file cannot be written from here the editor is read only and the toolbar
 * says why.
 */
export function CodeFile({ path, read, toolbarExtra }: CodeFileProps) {
    const { t } = useTranslation('panels');
    const theme = useCodeTheme();
    const wrap = useSettings((s) => s.codeWrap);
    // Where the placeholder was scrolled to, for the editor that replaces it.
    const viewerScroll = useRef(0);
    // A jump to a line is asked of a tab, so a node or a view of its own never answers one.
    const fileActions = useFileActions();
    const tabKey = fileActions?.tabKey ?? null;
    const nodeId = fileActions?.nodeId ?? null;
    const reveal = useFiles((s) => (s.revealLine !== null && s.revealLine.key === tabKey ? s.revealLine : null));
    const caret = useFiles((s) => (s.caret !== null && s.caret.key === tabKey ? s.caret : null));
    // Only a tab runs a `.sql` file on a connection; a node or a view of its own shows the file alone.
    const sqlTab = tabKey !== null && isSqlPath(path) ? tabKey : null;
    const binding = useFiles((s) => (sqlTab === null ? undefined : fileTabOf(s, sqlTab)?.console));

    const { chunks, lineCount } = useMemo(() => {
        // A file that ends in a newline has no last line, only a last line break.
        const lines = read.text.replace(/\n$/, '').split('\n');
        const blocks: { start: number; code: string; lines: number }[] = [];
        for (let i = 0; i < lines.length; i += CHUNK_LINES) {
            const block = lines.slice(i, i + CHUNK_LINES);
            blocks.push({ start: i + 1, code: block.join('\n'), lines: block.length });
        }
        return { chunks: blocks, lineCount: lines.length };
    }, [read.text]);
    // Text past what `fs.read` carries came as bytes, and a save of it would not fit `fs.write`.
    const large = read.size > FS_READ_MAX_TEXT_BYTES;
    const plain = large || lineCount > HIGHLIGHT_MAX_LINES;
    const language = plain ? null : (read.language ?? 'text');
    const editing = useFileEditing(path, read, plain, large);
    const disk = useMemo(() => ({ text: read.text, mtime: read.mtime }), [read]);
    const readOnlyReason =
        editing.block === null ? null : t(BLOCK_LABELS[editing.block], { lines: formatNumber(HIGHLIGHT_MAX_LINES), size: formatBytes(FS_READ_MAX_TEXT_BYTES) });
    const [editor, setEditor] = useState<Editor | null>(null);
    const surface = useRef<HTMLDivElement>(null);
    // Only the editor can be searched; the viewer that stands in while it loads, and for a finger, cannot.
    const find = useFind(surface, editor !== null, editorSeed(editor));
    const editorFind = useEditorFind(find, editor);
    const scope = useEditorScope(editor);
    useEffect(() => {
        if (caret === null || editor === null || readOnlyReason !== null) {
            return;
        }
        useFiles.getState().clearCaret();
        // A frame later: the cell takes the keyboard for the tab that just opened, and the editor comes after it.
        requestAnimationFrame(() => editor.focus());
    }, [caret, editor, readOnlyReason]);
    useEffect(() => {
        const element = surface.current;
        return editor === null || element === null ? undefined : registerFocusedEditor(editor, element);
    }, [editor]);
    const editorLanguage = useEditorLanguage(editor, path, plain ? undefined : read.language);
    useCodeVision(editorLanguage);
    useGitBlame(editorLanguage, path, read.text);
    useEffect(() => {
        const element = surface.current;
        return editorLanguage === null || element === null ? undefined : registerFocusedLanguage(editorLanguage, element);
    }, [editorLanguage]);
    useEffect(() => {
        editorLanguage?.selectionChat.bindNode(nodeId);
    }, [editorLanguage, nodeId]);
    useChangeMarks(editor, useGitBase(path, read.text));
    const agentChanges = useAgentChanges(editor, path, plain ? undefined : read.language);
    const conflict = useConflictResolution(editor, path);
    const folder = useProject((s) => s.current?.folder ?? null);
    // The Chats project has no databases, so its files read SQL against none.
    const databaseFolder = useProject((s) => shownFolderOf(s.current));

    /* The editor with its find bar, which a `.sql` tab in console mode draws inside the console. */
    const editorArea = (
        <div ref={surface} className="relative flex min-h-0 min-w-0 grow flex-col">
            {find.open && (
                <FindBar
                    find={find}
                    total={editorFind.total}
                    current={editorFind.current}
                    invalid={editorFind.invalid}
                    onStep={editorFind.step}
                    onSelectAll={editorFind.selectAll}
                    selectionScope={{ noSelection: editorFind.noSelection }}
                    replacement={{ onReplace: editorFind.replace, onReplaceAll: editorFind.replaceAll, disabledReason: readOnlyReason }}
                />
            )}
            {!editing.viewer && editing.engine !== null ? (
                <ErrorBoundary label={t('file.edit.failed')} resetKeys={[path, editing.engine]} className="min-h-0 grow">
                    <FileEditor
                        engine={editing.engine}
                        endpointId={editing.endpointId}
                        path={path}
                        disk={disk}
                        language={plain ? undefined : read.language}
                        wrap={wrap}
                        indentation={editing.indentation}
                        rightMargin={editing.rightMargin}
                        readOnlyReason={readOnlyReason}
                        placeholderScroll={viewerScroll}
                        focused={editing.focused}
                        reveal={reveal}
                        onEditor={setEditor}
                    />
                </ErrorBoundary>
            ) : (
                <FileScroll className="file-code" data-wrap={wrap} onScroll={(event) => (viewerScroll.current = event.currentTarget.scrollTop)}>
                    {chunks.map((chunk) => {
                        const location =
                            reveal === null
                                ? null
                                : {
                                      ...reveal,
                                      line: Math.min(reveal.line, lineCount),
                                      endLine: Math.min(reveal.endLine ?? reveal.line, lineCount)
                                  };
                        const inChunk = location !== null && location.endLine >= chunk.start && location.line < chunk.start + chunk.lines;
                        return (
                            <CodeChunk
                                key={chunk.start}
                                code={chunk.code}
                                lines={chunk.lines}
                                start={chunk.start}
                                language={language}
                                theme={theme}
                                reveal={inChunk ? location! : undefined}
                                revealNonce={inChunk ? reveal?.nonce : undefined}
                            />
                        );
                    })}
                </FileScroll>
            )}
        </div>
    );

    return (
        <div className="flex min-h-0 min-w-0 grow flex-col">
            <FileToolbar
                leading={
                    <FileBreadcrumb
                        path={path}
                        folder={folder}
                        scope={scope}
                        onSelect={(block) => {
                            editor?.revealLine(block.startLine);
                            editor?.focus();
                        }}
                    />
                }
            >
                {agentChanges.live !== null && <AgentEditingChip writer={agentChanges.live} />}
                {readOnlyReason !== null && (
                    <Tooltip label={readOnlyReason}>
                        <Pill>{t('file.edit.readOnly')}</Pill>
                    </Tooltip>
                )}
                {isSqlPath(path) && databaseFolder !== null && (
                    <ErrorBoundary label={t('databases:sql.failedToDraw')} resetKeys={[path]}>
                        <Suspense fallback={null}>
                            <SqlBindingPicker path={path} />
                        </Suspense>
                    </ErrorBoundary>
                )}
                {toolbarExtra}
            </FileToolbar>
            <DraftBar endpointId={editing.endpointId} path={path} />
            {agentChanges.review !== null && <ReviewBar review={agentChanges.review} />}
            {!editing.viewer && editing.loadFailed && (
                <EditorNotice message={t('file.edit.loadFailed')}>
                    <Button variant="secondary" size="sm" onClick={editing.retryLoad}>
                        {t('common:action.retry')}
                    </Button>
                </EditorNotice>
            )}
            {sqlTab === null ? (
                editorArea
            ) : (
                <ErrorBoundary label={t('databases:console.failedToDraw')} resetKeys={[binding?.connectionId]} className="min-h-0 grow">
                    <Suspense fallback={null}>
                        <SqlConsole tabKey={sqlTab} binding={binding} editor={editor} text={read.text} readOnly={readOnlyReason !== null}>
                            {editorArea}
                        </SqlConsole>
                    </Suspense>
                </ErrorBoundary>
            )}
            {agentChanges.hover !== null && (
                <ErrorBoundary label={t('file.edit.failed')} resetKeys={[agentChanges.hover.run.id]}>
                    <ProvenanceCard hover={agentChanges.hover} onHold={agentChanges.holdCard} />
                </ErrorBoundary>
            )}
            {editor !== null && (conflict !== null || agentChanges.review !== null) && (
                <ErrorBoundary label={t('file.edit.failed')} resetKeys={[editor]}>
                    {conflict !== null && <ConflictLayer conflict={conflict} editor={editor} />}
                    {agentChanges.review !== null && <ReviewLayer review={agentChanges.review} editor={editor} />}
                </ErrorBoundary>
            )}
            {editorLanguage !== null && (
                <ErrorBoundary label={t('file.edit.failed')} resetKeys={[editorLanguage]}>
                    <LanguagePopups language={editorLanguage} />
                </ErrorBoundary>
            )}
            {editor !== null && (
                <EditorStatusBar
                    editor={editor}
                    language={editorLanguage}
                    path={path}
                    languageId={plain ? undefined : read.language}
                    indentation={editing.indentation}
                    encoding={read.encoding}
                    lineEnding={lineEndingOf(read.text)}
                    scope={scope}
                />
            )}
        </div>
    );
}

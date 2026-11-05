import type { Editor } from '@adecore/editor';
import { usePatchDecorations } from '@adecore/editor-react';
import { ButtonGroup, ErrorBoundary, Pill, Tooltip } from '@adecore/ui';
import type { FsReadText } from '@ruimte/contracts';
import { FileDiff, FileText } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CodeFile } from '@/files/CodeFile';
import { CommitFileTree } from '@/files/CommitFileTree';
import { FileToolbarToggle } from '@/files/FileToolbar';
import { hasInconsistentHunk, patchSectionParts, sectionAt, sectionsOf, showsTree, type PatchSection } from '@/files/patch-tree';
import { COMMIT_TREE_MIN_WIDTH, TreeSplit } from '@/files/TreeSplit';
import { useEditorCaret } from '@/files/use-editor-caret';
import { useGit } from '@/state/git';
import { usePatchView } from '@/state/patch-view';
import { useProject } from '@/state/project';

/* The editor with the tree of the patch's files beside it, laid out like a commit tab. */
function PatchFrame({ tree, children }: { tree: ReactNode; children: ReactNode }) {
    const treeWidth = useGit((s) => s.commitTreeWidth);
    return (
        <TreeSplit
            side={tree === null ? null : <div className="flex min-h-0 grow flex-col overflow-hidden py-1">{tree}</div>}
            width={treeWidth}
            minWidth={COMMIT_TREE_MIN_WIDTH}
            onWidth={(next) => useGit.getState().setCommitTreeWidth(next)}
            stackedHeight="h-72"
        >
            <div className="flex min-h-0 min-w-0 grow flex-col">{children}</div>
        </TreeSplit>
    );
}

/*
 * A `.patch` or `.diff` file in the file editor, drawn as a diff and with its files in a tree. The
 * text is still the file: editing, saving and drafts are CodeFile's, and the switch in the bar
 * goes back to plain text.
 */
export function PatchFile({ path, read }: { path: string; read: FsReadText }) {
    const { t } = useTranslation('panels');
    const mode = usePatchView((s) => s.mode);
    const patchOn = mode === 'patch';
    const [editor, setEditor] = useState<Editor | null>(null);
    const [picked, setPicked] = useState<string | null>(null);
    const layout = usePatchDecorations(patchOn ? editor : null);
    const caret = useEditorCaret(patchOn ? editor : null);
    const sections = layout === null ? [] : sectionsOf(layout);
    const files = sections.map((section) => section.file);
    const byPath = new Map<string, PatchSection>(sections.map((section) => [section.path, section]));
    const shown = sectionAt(sections, caret.line)?.path ?? picked ?? sections[0]?.path ?? null;
    const tree = patchOn && showsTree(sections);
    /* A patch names its files from the root of the repository it was made in, which is the project's as often as not. */
    const folder = useProject((s) => s.current?.folder ?? null);

    const marks = (file: { path: string }) => {
        const section = byPath.get(file.path);
        return section === undefined ? [] : patchSectionParts(section, t('file.patch.binary'));
    };

    const pick = (sectionPath: string): void => {
        setPicked(sectionPath);
        const section = byPath.get(sectionPath);
        if (editor === null || section === undefined || sectionAt(sections, editor.getCaret().line)?.path === sectionPath) {
            return;
        }
        editor.revealLine(section.firstLine + 1, 'center');
    };

    const toolbar = (
        <>
            <ButtonGroup>
                <FileToolbarToggle icon={FileDiff} label={t('file.patch.patch')} active={patchOn} onClick={() => usePatchView.getState().setMode('patch')} />
                <FileToolbarToggle icon={FileText} label={t('file.patch.text')} active={!patchOn} onClick={() => usePatchView.getState().setMode('text')} />
            </ButtonGroup>
            {patchOn && layout?.truncated === true && (
                <Tooltip label={t('file.patch.truncatedHint')}>
                    <Pill>{t('file.patch.truncated')}</Pill>
                </Tooltip>
            )}
            {patchOn && layout !== null && hasInconsistentHunk(layout) && (
                <Tooltip label={t('file.patch.mismatchHint')}>
                    <Pill>{t('file.patch.mismatch')}</Pill>
                </Tooltip>
            )}
        </>
    );

    return (
        <CodeFile
            path={path}
            read={read}
            toolbarExtra={toolbar}
            onEditor={setEditor}
            frame={(area) => (
                <PatchFrame
                    tree={
                        tree ? (
                            <ErrorBoundary label={t('diff.commitCrashed')} resetKeys={[path]} className="min-h-0 grow">
                                <CommitFileTree files={files} shown={shown} onPick={pick} marks={marks} menu={folder === null ? undefined : { cwd: folder }} />
                            </ErrorBoundary>
                        ) : null
                    }
                >
                    {area}
                </PatchFrame>
            )}
        />
    );
}

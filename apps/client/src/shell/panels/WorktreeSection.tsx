import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ContextMenu } from '@base-ui-components/react/context-menu';
import { Menu } from '@base-ui-components/react/menu';
import { Eye, FolderX, GitBranch, GitMerge, LocateFixed, MoreHorizontal, Trash } from 'lucide-react';
import type { Worktree } from '@ruimte/contracts';
import { StatusDot } from '@/canvas/NodeFrame';
import { GitPrompt } from '@/shell/panels/GitDialogs';
import { nodesInWorktree, originLabel, sharePathsOf, workCounts } from '@/shell/panels/worktree-rows';
import { nodeWorking } from '@/state/agent-work';
import { useChats } from '@/state/chats';
import { useEndpointId } from '@/state/keys';
import { useSessions } from '@/state/sessions';
import { worktreeLists, type WorktreeNode } from '@/state/worktrees';
import { useToasts } from '@/state/toasts';
import { useTransport } from '@/transport/context';
import { MENU_SEPARATOR, SECTION_LABEL } from '@/ui/classes';
import { Icon } from '@/ui/Icon';
import { Pill } from '@/ui/Pill';
import { Tooltip } from '@/ui/Tooltip';

interface WorktreeSectionProps {
    /* The project folder the list is held for. */
    folder: string;
    worktrees: readonly Worktree[];
    /* Every node of the project, on every canvas, so a row can name the node working in it. */
    nodes: readonly WorktreeNode[];
    /* The checkout the panel is on, so its row reads as picked. */
    current: string | null;
    busy: boolean;
    onView(worktree: Worktree): void;
    onMerge(worktree: Worktree): void;
    onRemove(worktree: Worktree): void;
    onReveal(nodeId: string): void;
}

/*
 * The worktrees of the project's repository, each with the node that works in it and the work it
 * holds. It is the one place a worktree whose node is gone still shows up, which is what an agent
 * team leaves behind once its canvas is cleaned up.
 */
export function WorktreeSection({ folder, worktrees, nodes, current, busy, onView, onMerge, onRemove, onReveal }: WorktreeSectionProps) {
    const { t } = useTranslation('panels');
    const endpointId = useEndpointId();
    const sessions = useSessions((s) => s.byKey);
    const chats = useChats((s) => s.byKey);
    const sectionRef = useRef<HTMLElement>(null);
    const shown = worktrees.length > 0;
    const transport = useTransport();
    const [share, setShare] = useState<{ folder: string; paths: readonly string[] } | null>(null);
    const [sharing, setSharing] = useState(false);
    const shared = share?.folder === folder ? share.paths : [];

    useEffect(() => {
        if (!shown) {
            return;
        }
        let cancelled = false;
        transport
            .request('project.settings', { folder })
            .then((settings) => {
                if (!cancelled) {
                    setShare({ folder, paths: settings.worktrees?.share ?? [] });
                }
            })
            // A machine from before project settings has none to share.
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [transport, shown, folder]);

    const saveShare = (value: string): void => {
        const paths = sharePathsOf(value);
        transport
            .request('project.settings-update', { folder, settings: { worktrees: { share: paths } } })
            .then((settings) => {
                setShare({ folder, paths: settings.worktrees?.share ?? [] });
                setSharing(false);
            })
            .catch((error: unknown) => {
                const message = error instanceof Error ? error.message : t('error.generic');
                useToasts.getState().show({ title: t('worktree.share.saveFailed'), description: message, kind: 'error', output: message });
            });
    };

    useEffect(() => {
        const section = sectionRef.current;
        if (!shown || section === null) {
            return;
        }
        // Sliding or scrolling back into view is when the counts on screen may have gone stale.
        const observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
                worktreeLists.refreshCounts(endpointId, folder);
            }
        });
        observer.observe(section);
        return () => observer.disconnect();
    }, [shown, endpointId, folder]);

    if (worktrees.length === 0) {
        return null;
    }

    return (
        <section ref={sectionRef} className="flex max-h-48 shrink-0 flex-col border-t border-border">
            <div className="flex h-8 shrink-0 items-center gap-2 px-3">
                <span className={SECTION_LABEL}>{t('worktree.section.title')}</span>
                <span className="text-xs text-text-faint tabular-nums">{worktrees.length}</span>
                <span className="grow" />
                <Tooltip label={t('worktree.share.tooltip')}>
                    <button className="min-w-0 truncate text-xs text-text-faint hover:text-text" onClick={() => setSharing(true)}>
                        {shared.length === 0 ? t('worktree.share.none') : t('worktree.share.some', { paths: shared.join(', ') })}
                    </button>
                </Tooltip>
            </div>
            <GitPrompt
                open={sharing}
                title={t('worktree.share.title')}
                description={t('worktree.share.description')}
                field={{ label: t('worktree.share.field'), initial: shared.join(', '), placeholder: 'node_modules, .env' }}
                allowEmpty
                confirmLabel={t('common:action.save')}
                onConfirm={saveShare}
                onClose={() => setSharing(false)}
            />
            <ul className="min-h-0 overflow-y-auto pb-1">
                {worktrees.map((worktree) => {
                    const working = nodesInWorktree(nodes, worktree);
                    const names = working.map((node) => node.title || node.kind).join(', ');
                    const agentWorking = working.some((node) => nodeWorking(node, sessions, chats, endpointId));
                    const counts = worktree.work ? workCounts(worktree.work) : [];
                    const reveal = working[0]?.id ?? null;
                    return (
                        <ContextMenu.Root key={worktree.path}>
                            <ContextMenu.Trigger
                                render={<li />}
                                className="group flex h-8 items-center gap-2 pr-1 pl-3 hover:bg-surface-hover"
                                aria-current={worktree.path === current ? 'true' : undefined}
                            >
                                <Icon icon={worktree.missing ? FolderX : GitBranch} size={14} className="shrink-0 text-text-muted" />
                                <Tooltip label={worktree.path}>
                                    <button
                                        className="min-w-0 shrink truncate text-left font-mono text-sm text-text hover:underline disabled:no-underline"
                                        disabled={worktree.missing === true}
                                        onClick={() => onView(worktree)}
                                    >
                                        {worktree.branch}
                                    </button>
                                </Tooltip>
                                {agentWorking && <StatusDot status="running" />}
                                <span className="min-w-0 shrink-[2] truncate text-xs text-text-faint">
                                    {worktree.missing ? t('worktree.section.folderMissing') : names === '' ? t('worktree.section.noNode') : names}
                                    {originLabel(worktree) !== null && `, ${originLabel(worktree)}`}
                                </span>
                                <span className="grow" />
                                {counts.map((label) => (
                                    <Pill key={label} className="tabular-nums">
                                        {label}
                                    </Pill>
                                ))}
                                <Menu.Root>
                                    <Tooltip label={t('worktree.section.actions')} name>
                                        <Menu.Trigger className="icon-btn h-7 w-7 shrink-0" disabled={busy}>
                                            <Icon icon={MoreHorizontal} size={14} />
                                        </Menu.Trigger>
                                    </Tooltip>
                                    <Menu.Portal>
                                        <Menu.Positioner className="z-(--z-popup)" side="bottom" align="end" sideOffset={6}>
                                            <Menu.Popup className="menu-popup">
                                                <WorktreeMenuItems
                                                    worktree={worktree}
                                                    reveal={reveal}
                                                    onView={onView}
                                                    onMerge={onMerge}
                                                    onRemove={onRemove}
                                                    onReveal={onReveal}
                                                />
                                            </Menu.Popup>
                                        </Menu.Positioner>
                                    </Menu.Portal>
                                </Menu.Root>
                            </ContextMenu.Trigger>
                            <ContextMenu.Portal>
                                <ContextMenu.Positioner className="z-(--z-popup)">
                                    <ContextMenu.Popup className="menu-popup">
                                        <WorktreeMenuItems
                                            worktree={worktree}
                                            reveal={reveal}
                                            onView={onView}
                                            onMerge={onMerge}
                                            onRemove={onRemove}
                                            onReveal={onReveal}
                                        />
                                    </ContextMenu.Popup>
                                </ContextMenu.Positioner>
                            </ContextMenu.Portal>
                        </ContextMenu.Root>
                    );
                })}
            </ul>
        </section>
    );
}

interface WorktreeMenuProps extends Pick<WorktreeSectionProps, 'onView' | 'onMerge' | 'onRemove' | 'onReveal'> {
    worktree: Worktree;
    /* The node working in this worktree, which is what "show on canvas" points at. */
    reveal: string | null;
}

/*
 * What a worktree row can be asked. The overflow button and the right click on the row offer the
 * same list in the same order; `ContextMenu` draws a `Menu.Item` as its own.
 */
function WorktreeMenuItems({ worktree, reveal, onView, onMerge, onRemove, onReveal }: WorktreeMenuProps) {
    const { t } = useTranslation('panels');
    return (
        <>
            {!worktree.missing && (
                <>
                    <Menu.Item className="menu-item" onClick={() => onView(worktree)}>
                        <Icon icon={Eye} size={14} /> {t('worktree.section.view')}
                    </Menu.Item>
                    <Menu.Item className="menu-item" onClick={() => onMerge(worktree)}>
                        <Icon icon={GitMerge} size={14} /> {t('worktree.section.merge')}
                    </Menu.Item>
                </>
            )}
            {reveal !== null && (
                <Menu.Item className="menu-item" onClick={() => onReveal(reveal)}>
                    <Icon icon={LocateFixed} size={14} /> {t('file.menu.showOnCanvas')}
                </Menu.Item>
            )}
            {(!worktree.missing || reveal !== null) && <Menu.Separator className={MENU_SEPARATOR} />}
            <Menu.Item className="menu-item text-status-error" onClick={() => onRemove(worktree)}>
                <Icon icon={Trash} size={14} /> {t('worktree.section.remove')}
            </Menu.Item>
        </>
    );
}

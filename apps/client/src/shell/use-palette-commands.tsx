import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { shallow } from 'zustand/shallow';
import {
    CircleQuestionMark,
    FileText,
    Globe,
    LayoutGrid,
    MessageSquare,
    PenTool,
    SlidersHorizontal,
    Smartphone,
    StickyNote,
    Terminal,
    Workflow,
    Zap
} from 'lucide-react';
import { isCanvasView, isOpenableView, viewIconOf, type CanvasNodeKind } from '@ruimte/contracts';
import { Icon } from '@adecore/ui';
import { openProjectAction } from '@/actions/client-actions';
import { useBrowser } from '@/browser/registry';
import { viewShortcut } from '@/canvas/shortcuts';
import { isApplePlatform } from '@/desktop/bridge';
import { ProjectGlyph } from '@/project/ProjectGlyph';
import { ViewGlyph } from '@/project/ViewGlyph';
import { useViewNodes } from '@/project/view-nodes';
import { revealNode, showView } from '@/project/views';
import { openInNewWindow, wantsNewWindow } from '@/project/windows';
import { appCommands, OPENING_COMMAND_IDS, type Command } from '@/shell/commands';
import { PaletteEntryList, PaletteNote } from '@/shell/PaletteEntryList';
import { activeEntryOf, entryMatches, optionId, pageKeywords, type Entry, type PaletteContext, type PaletteModeView } from '@/shell/palette-entries';
import { readRecents, rememberRecent, sortByRecency } from '@/shell/palette-recents';
import { namesSetting, orderBelowJumps, settingsEntries } from '@/shell/palette-settings';
import { findSettings } from '@/shell/settings/find-settings';
import { useDocument } from '@/state/document';
import { useEndpoints } from '@/state/endpoints';
import { endpointKey } from '@/state/keys';
import { refreshPrRepos, useCurrentPrRepos } from '@/state/pr-repos';
import { useProject } from '@/state/project';
import { useProjectList } from '@/state/project-list';
import { useOpenEndpoints } from '@/transport/status';
import { AgentIcon } from '@adecore/agents-react/providers';

const KIND_ICON: Record<CanvasNodeKind, React.ReactNode> = {
    terminal: <Icon icon={Terminal} size={14} />,
    chat: <Icon icon={MessageSquare} size={14} />,
    browser: <Icon icon={Globe} size={14} />,
    device: <Icon icon={Smartphone} size={14} />,
    group: <Icon icon={LayoutGrid} size={14} />,
    note: <Icon icon={StickyNote} size={14} />,
    drawing: <Icon icon={PenTool} size={14} />,
    diagram: <Icon icon={Workflow} size={14} />,
    file: <Icon icon={FileText} size={14} />,
    unknown: <Icon icon={CircleQuestionMark} size={14} />
};

// What an empty palette shows of the two lists that have no natural end.
const OPENING_RECENTS = 5;
const OPENING_JUMPS = 8;

/* The palette as Cmd+K opens it: the nodes, views, projects, actions, settings and files that match the field. */
export function usePaletteCommands(context: PaletteContext, files: readonly Entry[], enabled: boolean): PaletteModeView {
    const { t } = useTranslation(['shell']);
    const { open, query, index, setIndex, close } = context;
    const nodesByView = useViewNodes((all, nodesOf) => new Map(all.map((view) => [view.id, nodesOf(view)])), shallow);
    const views = useDocument((s) => s.views);
    const activeViewId = useDocument((s) => s.activeViewId);
    // The command rows read it with appCommands(); the list only needs to redraw when it moves.
    const prRepos = useCurrentPrRepos();
    const projects = useProjectList((s) => s.projects);
    const currentProjectId = useProject((s) => s.current?.projectId ?? null);
    const currentEndpointId = useProject((s) => s.currentEndpointId);
    const endpoints = useEndpoints((s) => s.endpoints);
    const connected = useOpenEndpoints();
    // Only while the palette lists: a page that loads would otherwise redraw it for nothing.
    const pages = useBrowser((s) => (enabled ? s.byKey : null));
    const [recents, setRecents] = useState<string[]>(readRecents);

    useEffect(() => {
        if (open) {
            void refreshPrRepos();
        }
    }, [open]);

    const entries = useMemo<Entry[]>(() => {
        if (!enabled) {
            return [];
        }
        const pageOf = (id: string, url: string | undefined): string =>
            pageKeywords(url, currentEndpointId === null ? undefined : pages?.[endpointKey(currentEndpointId, id)]);
        // Every view, not only the canvas on screen; a node elsewhere says where it lives.
        const jumps: Entry[] = views.flatMap((view) => {
            if (!isCanvasView(view)) {
                return [];
            }
            const here = view.id === activeViewId;
            const viewNodes = nodesByView.get(view.id) ?? [];
            return viewNodes
                .filter((node) => node.kind !== 'group')
                .map((node) => ({
                    id: `node-${node.id}`,
                    label: node.title,
                    hint: here ? t(`nodeKinds.${node.kind}`) : t('palette.kindInView', { kind: t(`nodeKinds.${node.kind}`), view: view.name }),
                    icon: KIND_ICON[node.kind],
                    ...(node.kind === 'browser' ? { keywords: pageOf(node.id, node.url) } : {}),
                    here,
                    section: 'jump' as const,
                    run: () => revealNode(node.id)
                }));
        });
        const viewSwitches: Entry[] = views.filter(isOpenableView).map((view, at) => ({
            id: `view-${view.id}`,
            label: view.name ?? '',
            shortcut: viewShortcut(at),
            icon: (
                <ViewGlyph
                    id={view.id}
                    kind={view.kind}
                    icon={viewIconOf(view)}
                    provider={view.kind === 'chat' || view.kind === 'terminal' ? view.node.provider : null}
                    path={view.kind === 'file' ? view.path : null}
                />
            ),
            ...(view.kind === 'browser' ? { keywords: pageOf(view.id, view.url) } : {}),
            section: 'views' as const,
            run: () => showView(view.id)
        }));
        /* One list with the machine on the row, rather than a section per machine: a project is
           looked for by its own name, and which daemon it is on is what tells two of them apart. */
        const projectMachines = new Set(projects.map((row) => row.endpointId));
        const switches: Entry[] = projects
            .filter(
                (row) =>
                    row.summary.available &&
                    row.summary.scratch !== true &&
                    !(row.summary.projectId === currentProjectId && row.endpointId === currentEndpointId)
            )
            .map(({ endpointId, summary }) => {
                const where = summary.folder;
                const label = endpoints.find((endpoint) => endpoint.id === endpointId)?.label ?? t('start.anotherMachine');
                const machine = connected.includes(endpointId) ? label : t('palette.machineNotConnected', { machine: label });
                return {
                    id: `project-${endpointId}-${summary.projectId}`,
                    label: summary.name,
                    hint: projectMachines.size > 1 ? `${machine} · ${where}` : where,
                    icon: <ProjectGlyph projectId={summary.projectId} endpointId={endpointId} icon={summary.icon} color={summary.color} size={14} />,
                    section: 'projects',
                    run: () => openProjectAction(endpointId, summary.projectId),
                    inNewWindow: () => openInNewWindow(endpointId, summary.projectId)
                };
            });
        const commands = appCommands(prRepos);
        const asEntry = (command: Command, section: Entry['section']): Entry => ({
            ...command,
            icon: command.agent ? <AgentIcon kind={command.agent} /> : <Icon icon={Zap} size={14} />,
            section
        });
        if (query === '') {
            /* Nothing typed shows what was reached for last, the nodes of the canvas on screen, the
               views and a few featured actions; the rest of the catalog answers to a query. */
            const split = sortByRecency(commands, recents);
            const featured = split.rest.filter((command) => OPENING_COMMAND_IDS.includes(command.id));
            return [
                ...split.recent.slice(0, OPENING_RECENTS).map((command) => asEntry(command, 'recent')),
                ...jumps.filter((entry) => entry.here === true).slice(0, OPENING_JUMPS),
                ...viewSwitches,
                ...featured.map((command) => asEntry(command, 'actions'))
            ];
        }
        /* The file results already answer to the query in the daemon's ranking, so only the other
           sections are filtered. Views go first: every node's hint names its view, so its nodes
           would otherwise bury the view under its own name. */
        const keep = (entry: Entry): boolean => entryMatches(query, entry);
        const settings = settingsEntries(findSettings(query, isApplePlatform())).map((command): Entry => ({
            ...command,
            icon: <Icon icon={SlidersHorizontal} size={14} />,
            section: 'settings'
        }));
        const named = namesSetting(query, settings);
        const rest = [...switches.filter(keep), ...commands.map((command) => asEntry(command, 'actions')).filter(keep)];
        return [...viewSwitches.filter(keep), ...jumps.filter(keep), ...orderBelowJumps({ named, settings, files, rest })];
    }, [
        enabled,
        connected,
        endpoints,
        files,
        nodesByView,
        pages,
        views,
        activeViewId,
        query,
        recents,
        projects,
        currentProjectId,
        currentEndpointId,
        prRepos,
        t
    ]);

    const active = activeEntryOf(entries, index);
    const run = (entry: Entry | undefined, newWindow = false): void => {
        if (!entry) {
            return;
        }
        // Jumping to a node, a file, a view or a project is not a command; only what "Actions" lists comes back.
        if (
            entry.section !== 'jump' &&
            entry.section !== 'files' &&
            entry.section !== 'views' &&
            entry.section !== 'projects' &&
            entry.section !== 'settings'
        ) {
            setRecents(rememberRecent(entry.id));
        }
        close();
        if (newWindow && entry.inNewWindow) {
            entry.inNewWindow();
            return;
        }
        entry.run();
    };

    return {
        count: entries.length,
        activeOptionId: active ? optionId(entries.indexOf(active)) : undefined,
        enter: (event) => run(active, wantsNewWindow(event)),
        notes: entries.length === 0 && <PaletteNote>{t('palette.noMatch')}</PaletteNote>,
        results: <PaletteEntryList entries={entries} active={active} onHover={setIndex} onRun={run} />
    };
}

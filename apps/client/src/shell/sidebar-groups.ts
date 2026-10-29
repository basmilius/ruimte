import { useEffect, useMemo } from 'react';
import { useEndpoints } from '@/state/endpoints';
import { snoozeOf, useSnoozes } from '@/state/snooze';
import { useProject } from '@/state/project';
import { sidebarWaitingCount, useWaitingCount } from '@/state/attention';
import { useProjectList } from '@/state/project-list';
import { listedEndpoints } from '@/state/local-machine';
import { sidebarSelection } from './sidebar-selection';
import { machineTransport } from '@/transport';
import { placeSeparators, sidebarProjectKey, useSidebarMachines, useSidebarProjects, type SeparatorPlaces } from './sidebar-projects';
import type { SidebarGroup, SidebarNode, SidebarProject } from './sidebar-rows';

export function useSidebarGroups(enabled: boolean, active: SidebarProject, expandedIds: ReadonlySet<string>) {
    const endpoints = useEndpoints((state) => state.endpoints);
    const current = useProject((state) => state.current);
    const currentEndpointId = useProject((state) => state.currentEndpointId);
    const cached = useProjectList((state) => state.projects);
    const selected = useMemo(
        () => sidebarSelection(cached, listedEndpoints(endpoints), current && currentEndpointId ? { endpointId: currentEndpointId, summary: current } : null),
        [cached, endpoints, current, currentEndpointId]
    );
    const machines = useSidebarMachines(enabled, [...new Set(selected.map((row) => row.endpointId))]);
    const collapsed = useSidebarProjects((state) => state.collapsed);
    const expandedViews = useSidebarProjects((state) => state.expandedViews);
    const order = useSidebarProjects((state) => state.order);
    const separators = useSidebarProjects((state) => state.separators);
    const snoozes = useSnoozes((state) => state.byKey);
    const activeWaiting = useWaitingCount();
    const result = useMemo(() => {
        if (!enabled) {
            return { groups: [], incomplete: [], order: [], separators: { before: {}, trailing: [] } as SeparatorPlaces };
        }
        const groups: SidebarGroup[] = [];
        const incomplete: { label: string; state: SidebarGroup['state'] }[] = [];
        for (const endpoint of listedEndpoints(endpoints)) {
            const projects = selected.filter((row) => row.endpointId === endpoint.id);
            if (projects.length === 0) {
                continue;
            }
            const snapshot = machines[endpoint.id];
            if (snapshot?.state !== 'ready') {
                incomplete.push({ label: endpoint.label, state: snapshot?.state ?? 'loading' });
            }
            for (const { summary } of projects) {
                const views = snapshot?.projects.find((project) => project.summary.projectId === summary.projectId)?.views ?? null;
                const key = sidebarProjectKey(endpoint.id, summary.projectId);
                const isActive = currentEndpointId === endpoint.id && current?.projectId === summary.projectId;
                const state = isActive
                    ? machineTransport(endpoint.id).status === 'open'
                        ? 'ready'
                        : 'offline'
                    : !summary.available
                      ? 'error'
                      : snapshot?.state === 'ready' && views === null
                        ? 'error'
                        : (snapshot?.state ?? 'loading');
                const node = (value: NonNullable<typeof views>[number]['nodes'][number]): SidebarNode => ({
                    ...value,
                    draft: false,
                    status: state === 'ready' ? (snapshot?.statuses[`${value.kind}:${value.id}`] ?? value.status ?? null) : null,
                    snoozedUntil: snoozeOf(snoozes, endpoint.id, value.id)
                });
                if (state === 'error' && snapshot?.state === 'ready') {
                    incomplete.push({ label: `${summary.name} · ${endpoint.label}`, state });
                }
                const activeNode = (value: SidebarNode): SidebarNode => ({
                    ...value,
                    status: state !== 'ready' ? null : (snapshot?.statuses[`${value.kind}:${value.id}`] ?? value.status)
                });
                groups.push({
                    key,
                    endpointId: endpoint.id,
                    summary: isActive ? current! : summary,
                    machineLabel: endpoint.label,
                    active: isActive,
                    collapsed: collapsed.includes(key),
                    state,
                    waitingCount:
                        state !== 'ready' ? 0 : isActive ? activeWaiting : sidebarWaitingCount(views ?? [], snapshot?.statuses ?? {}, endpoint.id, snoozes),
                    expandedIds: isActive ? expandedIds : new Set(expandedViews[key] ?? []),
                    project: isActive
                        ? {
                              ...active,
                              views: active.views.map((view) => ({
                                  ...view,
                                  nodes: view.nodes.map(activeNode),
                                  self: view.self ? activeNode(view.self) : null
                              }))
                          }
                        : {
                              activeViewId: null,
                              openViewIds: [],
                              views: (views ?? []).map(({ design, ...view }) => ({
                                  ...view,
                                  // The wire's kinds are a closed list, so a design arrives as an unknown row that says what it is.
                                  kind: design === true ? 'design' : view.kind,
                                  nodes: view.nodes.map(node),
                                  self: view.self ? node(view.self) : null
                              }))
                          }
                });
            }
        }
        const keys = new Set(groups.map((group) => group.key));
        const kept = order.filter((key) => keys.has(key));
        const added = groups.filter((group) => !kept.includes(group.key));
        if (kept.length === 0) {
            added.sort((a, b) => b.summary.lastOpenedAt - a.summary.lastOpenedAt);
        }
        // The keys of projects not on screen stay, so a project that opens again takes its old place.
        const nextOrder = [...order, ...added.map((group) => group.key)];
        // The Chats project leads, wherever the order has it.
        const rank = (group: SidebarGroup): number => (group.summary.scratch === true ? -1 : nextOrder.indexOf(group.key));
        groups.sort((a, b) => rank(a) - rank(b));
        const places = placeSeparators(
            nextOrder,
            groups.filter((group) => group.summary.scratch !== true).map((group) => group.key),
            separators
        );
        return { groups, incomplete, order: nextOrder, separators: places };
    }, [
        enabled,
        machines,
        endpoints,
        current,
        currentEndpointId,
        selected,
        collapsed,
        expandedViews,
        expandedIds,
        active,
        activeWaiting,
        order,
        separators,
        snoozes
    ]);
    useEffect(() => {
        if (!enabled) {
            return;
        }
        if (result.order.length !== order.length || result.order.some((key, at) => key !== order[at])) {
            useSidebarProjects.getState().setOrder(result.order);
        }
    }, [enabled, result.order, order]);
    return result;
}

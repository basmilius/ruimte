import { useEffect, useMemo } from 'react';
import { useEndpoints } from '@/state/endpoints';
import { endpointKey } from '@/state/keys';
import { snoozeOf, useSnoozes } from '@/state/snooze';
import { useProject } from '@/state/project';
import { useProjectList } from '@/state/project-list';
import { listedEndpoints } from '@/state/local-machine';
import { sidebarSelection } from './sidebar-selection';
import { machineTransport } from '@/transport';
import { sidebarProjectKey, useSidebarMachines, useSidebarProjects } from './sidebar-projects';
import type { SidebarGroup, SidebarNode, SidebarProject } from './sidebar-rows';

export const useSidebarGroups = (enabled: boolean, active: SidebarProject, expandedIds: ReadonlySet<string>) => {
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
    const snoozes = useSnoozes((state) => state.byKey);
    const result = useMemo(() => {
        if (!enabled) {
            return { groups: [], incomplete: [], order: [] };
        }
        const groups: SidebarGroup[] = [];
        const incomplete: { label: string; state: SidebarGroup['state'] }[] = [];
        for (const endpoint of listedEndpoints(endpoints)) {
            const projects = selected.filter((row) => row.endpointId === endpoint.id);
            if (projects.length === 0) continue;
            const snapshot = machines[endpoint.id];
            if (snapshot?.state !== 'ready') incomplete.push({ label: endpoint.label, state: snapshot?.state ?? 'loading' });
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
                if (state === 'error' && snapshot?.state === 'ready') incomplete.push({ label: `${summary.name} · ${endpoint.label}`, state });
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
                              views: (views ?? []).map((view) => ({
                                  ...view,
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
        if (kept.length === 0) added.sort((a, b) => b.summary.lastOpenedAt - a.summary.lastOpenedAt);
        const nextOrder = [...kept, ...added.map((group) => group.key)];
        groups.sort((a, b) => nextOrder.indexOf(a.key) - nextOrder.indexOf(b.key));
        return { groups, incomplete, order: nextOrder };
    }, [enabled, machines, endpoints, current, currentEndpointId, selected, collapsed, expandedViews, expandedIds, active, order, snoozes]);
    // The attention watch only sees the project in this window; a snooze on another one ends when its row says so.
    useEffect(() => {
        const observed = new Map<string, boolean>();
        for (const group of result.groups) {
            if (group.active || group.state !== 'ready') {
                continue;
            }
            for (const node of group.project.views.flatMap((view) => [...view.nodes, ...(view.self ? [view.self] : [])])) {
                if (node.status !== null) {
                    observed.set(endpointKey(group.endpointId, node.id), node.status === 'needs-you');
                }
            }
        }
        useSnoozes.getState().observe(observed);
    }, [result.groups]);
    useEffect(() => {
        if (result.order.length !== order.length || result.order.some((key, at) => key !== order[at])) {
            useSidebarProjects.setState({ order: result.order });
        }
    }, [result.order, order]);
    return result;
};

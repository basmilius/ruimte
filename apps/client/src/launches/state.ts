import { useEffect, useMemo, useState } from 'react';
import type { LaunchBusy, LaunchesDocument, LaunchHeld, LaunchStatus, LaunchSuggestion } from '@ruimte/contracts';
import { create } from 'zustand';
import { EMPTY_DOCUMENT, launchViews, type LaunchView } from '@/launches/model';
import { LOCAL_ENDPOINT_ID } from '@/state/endpoints';
import { dropEndpoint, endpointKey, isOfEndpoint, useEndpointId } from '@/state/keys';
import { hasLocalMachine } from '@/state/local-machine';
import { useProject } from '@/state/project';
import { useTransport } from '@/transport/context';

/* The project a launch belongs to. Ids such as `dev` repeat from project to project, so whatever
   outlives a switch of project (a toast, a notification, a question) names its own. */
export interface LaunchOwner {
    endpointId: string;
    projectId: string;
}

/* A start that came back with a question for the person who asked. */
export type LaunchAsk =
    | { kind: 'held'; owner: LaunchOwner; launchId: string; restart: boolean; held: LaunchHeld[]; replace: boolean }
    | { kind: 'busy'; owner: LaunchOwner; launchId: string; restart: boolean; busy: LaunchBusy; approve: boolean };

/* The dialog the chip or the menu asked for: the editor on a launch (null is a new one), or the import. */
export type LaunchDialog = { kind: 'edit'; launchId: string | null } | { kind: 'import' };

type Statuses = Record<string, LaunchStatus>;

interface LaunchesState {
    /* By `endpointKey(endpointId, projectId)`. */
    documents: Record<string, LaunchesDocument>;
    /* By the same key, then by launch id: what ran since the machine started. */
    statuses: Record<string, Statuses>;
    ask: LaunchAsk | null;
    dialog: LaunchDialog | null;
    setDocument(endpointId: string, projectId: string, document: LaunchesDocument): void;
    setStatus(endpointId: string, status: LaunchStatus): void;
    /* Everything one machine says runs, in place of what was known before. */
    setList(endpointId: string, statuses: readonly LaunchStatus[]): void;
    setAsk(ask: LaunchAsk | null): void;
    setDialog(dialog: LaunchDialog | null): void;
    forget(endpointId: string): void;
}

export const useLaunches = create<LaunchesState>((set, get) => ({
    documents: {},
    statuses: {},
    ask: null,
    dialog: null,
    setDocument(endpointId, projectId, document) {
        set({ documents: { ...get().documents, [endpointKey(endpointId, projectId)]: document } });
    },
    setStatus(endpointId, status) {
        const key = endpointKey(endpointId, status.projectId);
        set({ statuses: { ...get().statuses, [key]: { ...get().statuses[key], [status.launchId]: status } } });
    },
    setList(endpointId, statuses) {
        const next = dropEndpoint(get().statuses, endpointId);
        for (const status of statuses) {
            const key = endpointKey(endpointId, status.projectId);
            next[key] = { ...next[key], [status.launchId]: status };
        }
        set({ statuses: next });
    },
    setAsk(ask) {
        set({ ask });
    },
    setDialog(dialog) {
        set({ dialog });
    },
    forget(endpointId) {
        const documents = Object.fromEntries(Object.entries(get().documents).filter(([key]) => !isOfEndpoint(key, endpointId)));
        set({ documents, statuses: dropEndpoint(get().statuses, endpointId) });
    }
}));

const NO_STATUSES: Statuses = {};

export interface ProjectLaunches {
    /* `endpointKey(endpointId, projectId)`, or null outside a project. */
    key: string | null;
    projectId: string | null;
    folder: string | null;
    /* Null until the machine answered. */
    document: LaunchesDocument | null;
    statuses: Statuses;
    views: Map<string, LaunchView>;
}

/* The launches of the project on screen, with the state of each. */
export function useProjectLaunches(): ProjectLaunches {
    const endpointId = useEndpointId();
    const projectId = useProject((s) => s.current?.projectId ?? null);
    const folder = useProject((s) => s.current?.folder ?? null);
    const key = projectId === null ? null : endpointKey(endpointId, projectId);
    const document = useLaunches((s) => (key === null ? null : (s.documents[key] ?? null)));
    const statuses = useLaunches((s) => (key === null ? NO_STATUSES : (s.statuses[key] ?? NO_STATUSES)));
    const views = useMemo(() => launchViews(document ?? EMPTY_DOCUMENT, statuses), [document, statuses]);
    return { key, projectId, folder, document, statuses, views };
}

/* A project on another machine answers on that machine's localhost, which a page here cannot reach. */
export function useAddressReachable(): boolean {
    const endpointId = useEndpointId();
    return endpointId === LOCAL_ENDPOINT_ID && hasLocalMachine();
}

export interface LaunchSuggestions {
    /* Null while the machine looks. */
    suggestions: readonly LaunchSuggestion[] | null;
    failed: boolean;
}

/* What the machine finds in the project to import, asked again each time a surface that shows it mounts. */
export function useLaunchSuggestions(projectId: string | null): LaunchSuggestions {
    const transport = useTransport();
    const [found, setFound] = useState<{ projectId: string; suggestions: readonly LaunchSuggestion[] | null; failed: boolean } | null>(null);

    useEffect(() => {
        if (projectId === null) {
            return;
        }
        let cancelled = false;
        transport
            .request('launches.detect', { projectId })
            .then((result) => {
                if (!cancelled) {
                    setFound({ projectId, suggestions: result.suggestions, failed: false });
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setFound({ projectId, suggestions: [], failed: true });
                }
            });
        return () => {
            cancelled = true;
        };
    }, [transport, projectId]);

    return found === null || found.projectId !== projectId ? { suggestions: null, failed: false } : found;
}

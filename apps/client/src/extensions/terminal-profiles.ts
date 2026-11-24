import type { ExtensionTerminalProfile } from '@ruimte/contracts';
import i18next from 'i18next';
import { SquareTerminal, type LucideIcon } from 'lucide-react';
import { useEffect, useSyncExternalStore } from 'react';
import type { Point } from '@/canvas-model/math';
import { namedIcon } from '@/extensions/host/named-icon';
import { extensionRequest } from '@/extensions/machine-request';
import { useProject } from '@/state/project';
import { useToasts } from '@/state/toasts';
import { machineTransport } from '@/transport';
import { orNull } from '@/transport-api/transport';
import { useMachineAnswers } from '@/transport/features';

/* Where a picked profile opens its terminal on a canvas; without it the terminal is a view of its own. */
export interface TerminalProfilePlace {
    viewId: string | null;
    at: Point;
}

interface TerminalProfiles {
    profiles: readonly ExtensionTerminalProfile[];
    open(profile: ExtensionTerminalProfile, place?: TerminalProfilePlace): void;
}

const NONE: readonly ExtensionTerminalProfile[] = [];
// What the machine answered last per project, so a menu that opens again draws its rows at once.
const listed = new Map<string, readonly ExtensionTerminalProfile[]>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
    listeners.add(listener);

    return () => listeners.delete(listener);
}

async function list(key: string, endpointId: string, projectId: string): Promise<void> {
    const answer = await orNull('extension.terminalProfiles', extensionRequest(machineTransport(endpointId), 'extension.terminalProfiles', { projectId }));

    if (answer === null) {
        return;
    }

    listed.set(key, answer.profiles);

    for (const listener of listeners) {
        listener();
    }
}

export function terminalProfileIcon(profile: ExtensionTerminalProfile): LucideIcon {
    return profile.icon === undefined ? SquareTerminal : namedIcon(profile.icon);
}

/*
 * The terminal profiles the extensions of the project's machine supply. The machine lists them from the manifests, so
 * one is there before its extension's `server/` ran, and it makes the terminal itself: that is how it knows which
 * profile starts the session, without a word of it in the project file.
 */
export function useTerminalProfiles(): TerminalProfiles {
    const projectId = useProject((s) => s.current?.projectId ?? null);
    const endpointId = useProject((s) => s.currentEndpointId);
    const answers = useMachineAnswers(endpointId ?? '', 'extension.terminalProfiles');
    const key = projectId === null || endpointId === null || !answers ? null : `${endpointId}\n${projectId}`;
    const profiles = useSyncExternalStore(subscribe, () => (key === null ? NONE : (listed.get(key) ?? NONE)));

    // Asked each time a menu that shows them opens, since an extension may have been turned on or off since.
    useEffect(() => {
        if (key !== null && projectId !== null && endpointId !== null) {
            void list(key, endpointId, projectId);
        }
    }, [key, projectId, endpointId]);

    return {
        profiles,
        open(profile, place) {
            if (projectId === null || endpointId === null) {
                return;
            }

            extensionRequest(machineTransport(endpointId), 'extension.terminalOpen', {
                id: profile.extension,
                projectId,
                profile: profile.id,
                picked: true,
                title: profile.title,
                ...(place === undefined || place.viewId === null ? {} : { viewId: place.viewId, at: place.at })
            }).catch((e: unknown) => {
                useToasts.getState().show({
                    kind: 'error',
                    title: i18next.t('canvas:canvasMenu.profileFailed', { name: profile.title }),
                    description: e instanceof Error ? e.message : String(e)
                });
            });
        }
    };
}

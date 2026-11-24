import { messageOf } from '@adecore/ui';
import type { ExtensionComposerCommand, ExtensionComposerReference } from '@ruimte/contracts';
import { useEffect, useState } from 'react';
import { useProject } from '@/state/project';
import { transportFor } from '@/transport';
import { orNull } from '@/transport-api/transport';
import { useMachineAnswers } from '@/transport/features';
import { useEndpointConnection } from '@/transport/status';

interface Offered {
    key: string;
    references: readonly ExtensionComposerReference[];
    commands: readonly ExtensionComposerCommand[];
}

interface MachineComposer {
    references: readonly ExtensionComposerReference[];
    commands: readonly ExtensionComposerCommand[];
    /* The text a pick puts in the prompt. A read the machine refused says so in the prompt, where the person sees it before sending. */
    read(reference: ExtensionComposerReference): Promise<string>;
    expand(command: ExtensionComposerCommand, args: string): Promise<string>;
}

const NOTHING: readonly never[] = [];

/*
 * What the extensions of the window's machine offer after `#` and `/` from their `server/`, for the project on screen.
 * Asked once per chat box and again when the machine's extensions change, as the things of `client/` are.
 */
export function useMachineComposer(): MachineComposer {
    const endpointId = useProject((s) => s.currentEndpointId);
    const projectId = useProject((s) => s.current?.projectId ?? null);
    const answers = useMachineAnswers(endpointId ?? '', 'extension.composerItems');
    const open = useEndpointConnection(endpointId ?? '').status === 'open';
    const [offered, setOffered] = useState<Offered | null>(null);
    const key = endpointId !== null && projectId !== null && answers && open ? `${endpointId}\n${projectId}` : null;

    useEffect(() => {
        const link = key === null || endpointId === null ? null : transportFor(endpointId);

        if (link === null || key === null || projectId === null) {
            return;
        }

        let alive = true;
        const read = (): void => {
            void orNull('extension.composerItems', link.request('extension.composerItems', { projectId })).then((answer) => {
                if (alive && answer !== null) {
                    setOffered({ key, ...answer });
                }
            });
        };
        const off = link.on('extension.changed', read);

        read();

        return () => {
            alive = false;
            off();
        };
    }, [key, endpointId, projectId]);

    const current = offered !== null && offered.key === key ? offered : null;
    const ask = async (what: string, request: () => Promise<{ text: string }> | undefined): Promise<string> => {
        try {
            const answer = await request();

            return answer === undefined ? `(${what} could not be read: this machine is not connected)` : answer.text;
        } catch (e) {
            return `(${what} could not be read: ${messageOf(e)})`;
        }
    };

    return {
        references: current?.references ?? NOTHING,
        commands: current?.commands ?? NOTHING,
        read: (reference) =>
            ask(reference.name, () =>
                transportFor(endpointId ?? '')?.request('extension.referenceRead', {
                    projectId: projectId ?? '',
                    extension: reference.extension,
                    reference: reference.reference,
                    id: reference.id,
                    name: reference.name
                })
            ),
        expand: (command, args) =>
            ask(`/${command.name}`, () =>
                transportFor(endpointId ?? '')?.request('extension.commandExpand', {
                    projectId: projectId ?? '',
                    extension: command.extension,
                    name: command.name,
                    args
                })
            )
    };
}

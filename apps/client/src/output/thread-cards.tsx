import type { ThreadCard } from '@adecore/agents-react';
import { useChatRow } from '@adecore/agents-react/state';
import type { ArtifactSummary } from '@ruimte/contracts';
import { useEffect, useState } from 'react';
import { useArtifactList, useArtifacts } from '@/output/artifacts';
import { groupsBetweenItems } from '@/output/saved-groups';
import { SavedCard, type Saved } from '@/output/SavedCard';
import { endpointKey } from '@/state/keys';
import { machineTransport } from '@/transport';
import { useMachineAnswers } from '@/transport/features';

const NO_ARTIFACTS: readonly ArtifactSummary[] = [];
const NO_CARDS: readonly ThreadCard[] = [];

/*
 * A card in the thread for every version this chat saved to Output, at the moment it was saved. The
 * cards are the client's own rows between the chat's items and never a chat item, so the thread on
 * the wire, and every client that reads it, stays as it was. A chat's scope is the machine it runs on.
 */
export function useOutputThreadCards(scopeId: string, chatId: string): readonly ThreadCard[] {
    const answers = useMachineAnswers(scopeId, 'artifact.list');
    const list = useArtifactList(scopeId, { chatId }, answers);
    const artifacts = list?.status === 'ready' ? list.artifacts : NO_ARTIFACTS;
    const read = useReadVersions(scopeId, artifacts);
    const structure = useChatRow(chatId, (row) => row?.structure);
    const itemTimes = structure === undefined ? [] : Object.values(structure).map((item) => item.createdAt);
    // Output survives a clear; only versions from the conversation still in this thread belong here.
    const from = itemTimes.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...itemTimes);
    const saved = artifacts
        .flatMap((summary) => read[summary.artifactId] ?? [{ artifact: summary, version: summary.latest, latest: true }])
        .filter((entry) => entry.version.provenance.chatId === chatId && entry.version.createdAt >= from);
    const groups = groupsBetweenItems(saved, itemTimes);
    const shape = `${scopeId}\n\n${groups
        .map((group) => group.map((entry) => `${entry.version.versionId}:${entry.latest}:${entry.artifact.title}:${entry.artifact.kind}`).join('\n'))
        .join('\n\n')}`;
    const [held, setHeld] = useState<{ shape: string; cards: readonly ThreadCard[] }>({ shape: '', cards: NO_CARDS });
    // The thread lays its rows out again on every new array, so a new one is made only when what it shows changed.
    if (held.shape !== shape) {
        setHeld({ shape, cards: groups.map((group) => cardOf(scopeId, group)) });
    }
    return held.cards;
}

/*
 * Every version of the artifacts of more than one, by artifact, read again whenever the machine says
 * one changed. What an older read found stays until the next lands, so a card never blinks out.
 */
function useReadVersions(endpointId: string, artifacts: readonly ArtifactSummary[]): Readonly<Record<string, Saved[]>> {
    const revisions = useArtifacts((state) => state.revisions);
    const wanted = artifacts
        .filter((artifact) => artifact.versionCount > 1)
        .map((artifact) => `${artifact.artifactId}@${revisions[endpointKey(endpointId, artifact.artifactId)] ?? 0}`)
        .join(',');
    const [read, setRead] = useState<Readonly<Record<string, Saved[]>>>({});

    useEffect(() => {
        if (wanted === '') {
            return;
        }
        let live = true;
        const transport = machineTransport(endpointId);
        const artifactIds = wanted.split(',').map((entry) => entry.slice(0, entry.lastIndexOf('@')));
        void Promise.all(
            artifactIds.map((artifactId) =>
                transport
                    .request('artifact.get', { artifactId })
                    .then(({ artifact, versions }) => [artifactId, versions.map((version, index) => ({ artifact, version, latest: index === 0 }))] as const)
                    .catch(() => null)
            )
        ).then((results) => {
            if (live) {
                setRead((current) => ({ ...current, ...Object.fromEntries(results.filter((result) => result !== null)) }));
            }
        });
        return () => {
            live = false;
        };
    }, [endpointId, wanted]);

    return read;
}

// Placed at the last version, so a turn's card stands under the commands that made it.
function cardOf(endpointId: string, group: readonly Saved[]): ThreadCard {
    const first = group[0]!.version;
    return {
        id: `output:${first.versionId}`,
        at: group.at(-1)!.version.createdAt,
        render: () => <SavedCard endpointId={endpointId} saved={group} />
    };
}

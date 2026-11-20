import type { AgentMark, HostSkill } from '@adecore/agents-react';
import type { SkillEntry } from '@ruimte/contracts';
import { create } from 'zustand';
import { orNull, readOnEveryOpen, type Transport } from '@/transport-api/transport';
import { RUIMTE_MARK_PATHS, RUIMTE_MARK_VIEW_BOX } from '@/ui/ruimte-mark-paths';

const RUIMTE_SKILL_MARK: AgentMark = { title: 'Ruimte', viewBox: RUIMTE_MARK_VIEW_BOX, path: RUIMTE_MARK_PATHS.join(' ') };

const NO_SKILLS: readonly HostSkill[] = [];

interface HostSkillStore {
    byEndpoint: Readonly<Record<string, readonly HostSkill[]>>;
    receive(endpointId: string, skills: readonly SkillEntry[]): void;
    forget(endpointId: string): void;
}

function sameSkills(held: readonly HostSkill[], skills: readonly SkillEntry[]): boolean {
    return (
        held.length === skills.length &&
        held.every((skill, i) => skill.name === skills[i]?.name && skill.title === skills[i]?.title && skill.description === skills[i]?.description)
    );
}

export const useHostSkills = create<HostSkillStore>((set, get) => ({
    byEndpoint: {},
    receive(endpointId, skills) {
        const held = get().byEndpoint[endpointId] ?? NO_SKILLS;

        // The composer's `$` menu takes the same array while nothing changed.
        if (sameSkills(held, skills)) {
            return;
        }

        const made = skills.map(({ name, title, description }) => ({ name, title, description, icon: RUIMTE_SKILL_MARK }));

        set({ byEndpoint: { ...get().byEndpoint, [endpointId]: made } });
    },
    forget(endpointId) {
        const { [endpointId]: _gone, ...rest } = get().byEndpoint;

        set({ byEndpoint: rest });
    }
}));

/* The skills a machine ships, picked after `$` in a chat on it; empty while loading, failed or unsupported. */
export function useSkillsOf(endpointId: string): readonly HostSkill[] {
    return useHostSkills((s) => s.byEndpoint[endpointId] ?? NO_SKILLS);
}

/* One machine's skills, asked again on every fresh link. `answers` says whether it ships any. */
export function watchHostSkills(endpointId: string, transport: Transport, answers: () => boolean): () => void {
    let generation = 0;

    const refresh = (): void => {
        const current = ++generation;

        if (!answers()) {
            useHostSkills.getState().forget(endpointId);

            return;
        }

        // A failed ask keeps what the machine said last; the next open link asks again.
        void orNull('skill.list', transport.request('skill.list', {})).then((listed) => {
            if (listed !== null && current === generation) {
                useHostSkills.getState().receive(endpointId, listed.skills);
            }
        });
    };

    const offStatus = readOnEveryOpen(transport, refresh);

    return () => {
        generation++;
        offStatus();
        useHostSkills.getState().forget(endpointId);
    };
}

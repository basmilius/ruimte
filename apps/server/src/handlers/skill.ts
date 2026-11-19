import type { SkillEntry } from '@ruimte/contracts';
import type { Area } from '../area.ts';

interface SkillDeps {
    /* The skills Ruimte ships, whether or not this machine could place their files. */
    skills(): readonly SkillEntry[];
}

export function skillArea({ skills }: SkillDeps): Area {
    return {
        name: 'skill',
        handlers: (dispatcher) => {
            dispatcher.register('skill.list', () => ({
                skills: skills().map(({ name, title, description }) => ({ name, title, description }))
            }));
        }
    };
}

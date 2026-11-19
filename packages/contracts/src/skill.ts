import { EmptySchema } from '@adecore/agent-contracts/protocol';
import { z } from 'zod';

/* A skill Ruimte ships: a prompt names it with `$<name>`, and a person reads it as its title. */
export const SkillEntrySchema = z.object({
    name: z.string().min(1).max(128),
    title: z.string().min(1).max(128),
    description: z.string().max(1024)
});
export type SkillEntry = z.infer<typeof SkillEntrySchema>;

export const SkillListSchema = z.object({ skills: z.array(SkillEntrySchema).max(100) });
export type SkillList = z.infer<typeof SkillListSchema>;

export const SKILL_REQUEST_SCHEMAS = {
    'skill.list': { payload: EmptySchema, result: SkillListSchema }
} as const;

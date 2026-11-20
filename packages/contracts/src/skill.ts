import { EmptySchema } from '@adecore/agent-contracts/protocol';
import { z } from 'zod';

/* A skill Ruimte ships: a prompt names it with `$<name>`, and a person reads it as its title. */
export const SkillEntrySchema = z.object({
    name: z.string().min(1).max(128),
    title: z.string().min(1).max(128),
    description: z.string().max(1024)
});
export type SkillEntry = z.infer<typeof SkillEntrySchema>;

// Every skill Ruimte ships is named `ruimte-<title>`, so a token reads as its title without the list of skills.
const RUIMTE_SKILL_TOKEN = /(^|[\s([{"'])\$ruimte-([a-z0-9]+(?:-[a-z0-9]+)*)(?![A-Za-z0-9_:-])/g;

/* The text with each skill Ruimte ships named by its title, `$design` for `$ruimte-design`, for a title made from a prompt. */
export function withSkillTitles(text: string): string {
    return text.replace(RUIMTE_SKILL_TOKEN, (_token, before: string, title: string) => `${before}$${title}`);
}

export const SkillListSchema = z.object({ skills: z.array(SkillEntrySchema).max(100) });
export type SkillList = z.infer<typeof SkillListSchema>;

export const SKILL_REQUEST_SCHEMAS = {
    'skill.list': { payload: EmptySchema, result: SkillListSchema }
} as const;

// @ts-expect-error Bun hands over the file's text, so a compiled daemon carries it; TypeScript only knows the module.
import designInstructions from './design/SKILL.md' with { type: 'text' };
import { builtInSkill, type RuimteSkill } from './ruimte-skills.ts';

/* The skills the daemon ships. Each file is imported here, since the compiled daemon carries only what is imported. */
export const RUIMTE_SKILLS: readonly RuimteSkill[] = [builtInSkill('design', { 'SKILL.md': designInstructions as string })];

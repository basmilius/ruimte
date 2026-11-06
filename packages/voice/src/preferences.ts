import { ACTION_DOMAINS, voiceToolsFor, type ActionDomain, type VoiceToolDefinition } from '@ruimte/actions';
import { LiveVoiceSchema, VoiceLanguageSchema } from '@ruimte/contracts';
import { z } from 'zod';

function isDomain(value: unknown): value is ActionDomain {
    return (ACTION_DOMAINS as readonly unknown[]).includes(value);
}

/*
 * What a window asks of a live session. The desktop shell parses it from what the page sent, so the
 * page's type (`OpenAiLivePreferences` in `@ruimte/desktop-bridge`) and this one are held to each other
 * by a test where both are visible.
 */
export const LiveSessionPreferencesSchema = z.object({
    language: VoiceLanguageSchema,
    voice: LiveVoiceSchema,
    // A domain this build does not know comes from a newer page and is left out, not refused.
    domains: z
        .array(z.unknown())
        .transform((domains) => domains.filter(isDomain))
        .optional()
});
export type LiveSessionPreferences = z.output<typeof LiveSessionPreferencesSchema>;

export function parseOpenAiLivePreferences(value: unknown): LiveSessionPreferences | null {
    const parsed = LiveSessionPreferencesSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
}

/* Only the tools of the domains the page asked for; a page that named none gets every tool. */
export function liveTools(preferences: LiveSessionPreferences): VoiceToolDefinition[] {
    return voiceToolsFor(preferences.domains ?? ACTION_DOMAINS);
}

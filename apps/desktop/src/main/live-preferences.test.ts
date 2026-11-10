import { expect, test } from 'bun:test';
import type { OpenAiLivePreferences } from '@ruimte/desktop-bridge';
import { parseOpenAiLivePreferences, type LiveSessionPreferences } from '@ruimte/voice';

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/* The page sends one type and the shell parses another; if either moves, this stops compiling. */
const sameShape: Same<Omit<OpenAiLivePreferences, 'domains'>, Omit<LiveSessionPreferences, 'domains'>> = true;
const domainsFit: LiveSessionPreferences['domains'] extends string[] | undefined ? true : false = true;

test('the shell parses what the page sends', () => {
    const sent: OpenAiLivePreferences = { language: 'nl', voice: 'cedar', domains: ['workspace', 'future'] };

    expect(sameShape && domainsFit).toBe(true);
    expect(parseOpenAiLivePreferences(sent)).toEqual({ language: 'nl', voice: 'cedar', domains: ['workspace'] });
});

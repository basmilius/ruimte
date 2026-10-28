import { expect, test } from 'bun:test';
import { USAGE_VERB_COUNTERS, USAGE_VIEW_COUNTERS } from '@ruimte/pulsar';
import { CONTEXT_VERBS } from './context.ts';
import { PROJECT_VIEW_KINDS } from './project.ts';

// A separator and a subheader only shape the sidebar; a person never opens one.
const UNOPENED_VIEW_KINDS = ['separator', 'subheader'];

// Nothing of Output goes into a usage count (`apps/server/src/artifacts/CLAUDE.md`). A design waits on a counter the address book reads: its batch is frozen and read strictly.
const UNCOUNTED_VIEW_KINDS = ['artifact', 'design'];

test('every view kind a person opens has a usage counter', () => {
    const opened = PROJECT_VIEW_KINDS.filter((kind) => !UNOPENED_VIEW_KINDS.includes(kind) && !UNCOUNTED_VIEW_KINDS.includes(kind));
    expect(Object.keys(USAGE_VIEW_COUNTERS).sort()).toEqual([...opened].sort());
});

test('every ruimte-context verb counts in a usage group', () => {
    expect(Object.keys(USAGE_VERB_COUNTERS).sort()).toEqual([...CONTEXT_VERBS].sort());
});

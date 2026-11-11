import { describe, expect, test } from 'bun:test';
import { wireStampsIn, type OpenWords, type WireDegradation } from '@adecore/agent-contracts/tolerance';
import type { z } from 'zod';
import wire from '../../../apps/ios/Packages/RuimtePulsar/Tests/RuimtePulsarTests/Fixtures/wire.json';
import { EVENT_SCHEMAS, REQUEST_SCHEMAS, WRITTEN_BACK_EVENTS, WRITTEN_BACK_REPLIES, type EventType, type RequestType } from './index.ts';
import { readFromMachine, type MachineOpenWords } from './tolerance.ts';

interface Tolerated {
    schema: string;
    input: unknown;
    output: unknown;
    degraded: WireDegradation[];
}

function schemaOf(name: string): z.core.$ZodType {
    const request = /^request\.(.+)\.result$/.exec(name);

    return request ? REQUEST_SCHEMAS[request[1] as RequestType].result : EVENT_SCHEMAS[name.replace(/^event\./, '') as EventType];
}

function at(value: unknown, path: readonly (string | number)[]): unknown {
    return path.reduce<unknown>((inside, key) => (inside as Record<string | number, unknown>)[key], value);
}

// The iPhone app's interpreter keeps an unknown member as it came with `x-unknown` on it; this reader as `{ [tag]: 'unknown', raw }`.
function markedLikeThePhone(data: unknown, degraded: readonly WireDegradation[]): unknown {
    const copy = structuredClone(data);

    for (const entry of degraded) {
        if (entry.kind !== 'unknown-member') {
            continue;
        }

        const parent = at(copy, entry.path.slice(0, -1)) as Record<string | number, unknown> | undefined;
        const key = entry.path.at(-1);
        const read = (key === undefined ? copy : parent?.[key]) as { raw: object };
        const marked = { ...read.raw, 'x-unknown': true };

        if (key === undefined) {
            return marked;
        }

        parent![key] = marked;
    }

    return copy;
}

describe('reading what a newer machine sent', () => {
    // The same cases the iPhone app's tests read, so the two clients give up the same things to read the rest.
    test.each((wire.tolerated as Tolerated[]).map((entry) => [entry.schema, entry] as const))('%s degrades as the iPhone app does', (_name, entry) => {
        const read = readFromMachine(schemaOf(entry.schema), entry.input);

        if (!read.success) {
            throw new Error(read.error.message);
        }

        expect(read.degraded).toEqual(entry.degraded);
        expect(markedLikeThePhone(read.data, read.degraded)).toEqual(entry.output);
    });
});

describe('what a client writes back', () => {
    // A node or view left out of what a client read would be deleted by its next save, so these keep every element.
    test.each([...WRITTEN_BACK_REPLIES.map((type) => `request.${type}.result`), ...WRITTEN_BACK_EVENTS.map((event) => `event.${event}`)])(
        '%s has no list that leaves an element out and no member kept as unknown',
        (name) => {
            const stamps = wireStampsIn(schemaOf(name)).filter(({ stamp }) => stamp.open !== 'values');

            expect(stamps).toEqual([]);
        }
    );
});

describe('the table that types a read from a machine', () => {
    test('names every enum the contracts stamp as open', () => {
        const words = {
            AgentIntegrationState: true,
            AgentStatus: true,
            ChatBackgroundTaskKind: true,
            ChatGoalStatus: true,
            ChatRequestKind: true,
            ChatTurnLimitKind: true,
            KeepAwakeMode: true,
            MachineUpdateStatus: true,
            ProjectSidebarNodeKind: true,
            ProjectSidebarViewKind: true,
            PushNotifyKind: true,
            Reachability: true,
            RuntimeMode: true,
            TaskPauseKind: true,
            TaskResultSource: true,
            TaskStatus: true,
            TaskWake: true,
            TerminalShell: true,
            TunnelProposalAction: true,
            UsageProvider: true,
            VoiceActivityKind: true,
            VoiceActivityStatus: true,
            VoicePhase: true
        } satisfies Record<keyof (OpenWords & MachineOpenWords), true>;
        // Already any string to a strict parse, or only compared and sent back as they came (`MachineOpenWords`).
        const strings = new Set(['AgentKind', 'ArtifactKind', 'ProjectIconName', 'EndpointNameSource', 'NodeTitleSource', 'ProjectNameSource']);
        const schemas = [...Object.values(REQUEST_SCHEMAS).map(({ result }) => result), ...Object.values(EVENT_SCHEMAS)];
        const stamped = new Set(
            schemas.flatMap((schema) => wireStampsIn(schema).flatMap(({ stamp }) => (stamp.open === 'values' && !strings.has(stamp.name) ? [stamp.name] : [])))
        );

        expect([...stamped].sort()).toEqual(Object.keys(words).sort());
    });
});

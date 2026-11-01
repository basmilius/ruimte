import { EVENT_SCHEMAS, REQUEST_SCHEMAS, type ParseResult, type ServerFrame } from '@ruimte/contracts';
import type { PerformanceCase } from './paired';

interface Protocol {
    parseServerFrame(input: unknown): ParseResult<ServerFrame>;
}

declare global {
    var __ruimteProtocolResult: unknown;
}

function witness(value: ParseResult<ServerFrame>): string {
    globalThis.__ruimteProtocolResult = value;

    if (!value.ok) {
        return value.message;
    }

    return 'event' in value.value ? value.value.event : (value.value.id ?? 'null');
}

export function protocolCases(before: Protocol, after: Protocol): PerformanceCase[] {
    const cases: PerformanceCase[] = [];

    for (const size of [16, 4096, 65536]) {
        const frame = { type: 'event', event: 'session.output', payload: { sessionId: 'terminal-1', data: 'x'.repeat(size) } };
        const raw = JSON.stringify(frame);
        const decoded = (protocol: Protocol): ParseResult<ServerFrame> => {
            const parsed = protocol.parseServerFrame(JSON.parse(raw));

            if (!parsed.ok || !('event' in parsed.value)) {
                throw new Error('Event did not decode');
            }

            return { ok: true, value: { ...parsed.value, payload: EVENT_SCHEMAS['session.output'].parse(parsed.value.payload) } };
        };

        if (
            JSON.stringify(before.parseServerFrame(frame)) !== JSON.stringify(after.parseServerFrame(frame)) ||
            JSON.stringify(decoded(before)) !== JSON.stringify(decoded(after))
        ) {
            throw new Error('Protocol output differs');
        }

        cases.push(
            { name: `envelope/event/${size}`, before: () => witness(before.parseServerFrame(frame)), after: () => witness(after.parseServerFrame(frame)) },
            { name: `decode+validate/event/${size}`, before: () => witness(decoded(before)), after: () => witness(decoded(after)) }
        );
    }

    for (const frame of [
        { id: 'reply', ok: true, result: { time: 1000 } },
        { id: null, ok: false, error: { code: 'bad-request', message: 'Frame is not valid JSON' } },
        { type: 'event', event: '', payload: null },
        { type: 'event', event: 'session.output', payload: {}, ok: true, id: 'both', result: 'reply wins' }
    ]) {
        const name = 'event' in frame ? (frame.event === '' ? 'invalid-event' : 'ambiguous-reply') : frame.ok ? 'reply-ok' : 'reply-error';
        const raw = JSON.stringify(frame);
        const run = (protocol: Protocol): ParseResult<ServerFrame> => {
            const parsed = protocol.parseServerFrame(JSON.parse(raw));

            if (parsed.ok && 'ok' in parsed.value && parsed.value.ok && name === 'reply-ok') {
                return { ok: true, value: { ...parsed.value, result: REQUEST_SCHEMAS['server.ping'].result.parse(parsed.value.result) } };
            }

            return parsed;
        };

        if (JSON.stringify(run(before)) !== JSON.stringify(run(after))) {
            throw new Error(`Protocol output differs: ${name}`);
        }

        cases.push({ name: `decode+validate/${name}`, before: () => witness(run(before)), after: () => witness(run(after)) });
    }

    const chatFrame = {
        type: 'event',
        event: 'chat.event',
        payload: { chatId: 'chat-1', seq: 10, event: { type: 'delta', itemId: 'item-1', text: 'streamed output' } }
    };
    const rawChat = JSON.stringify(chatFrame);
    const chat = (protocol: Protocol): ParseResult<ServerFrame> => {
        const parsed = protocol.parseServerFrame(JSON.parse(rawChat));

        if (!parsed.ok || !('event' in parsed.value)) {
            throw new Error('Chat event did not decode');
        }

        return { ok: true, value: { ...parsed.value, payload: EVENT_SCHEMAS['chat.event'].parse(parsed.value.payload) } };
    };

    if (JSON.stringify(chat(before)) !== JSON.stringify(chat(after))) {
        throw new Error('Chat output differs');
    }

    cases.push({ name: 'decode+validate/chat-delta', before: () => witness(chat(before)), after: () => witness(chat(after)) });

    const mixed = Array.from({ length: 100 }, (_, index) =>
        JSON.stringify(
            index % 5 === 0 ? { id: `reply-${index}`, ok: true, result: { time: index } } : { ...chatFrame, payload: { ...chatFrame.payload, seq: index + 1 } }
        )
    );
    const decodeMixed = (protocol: Protocol) =>
        mixed.map((raw) => {
            const parsed = protocol.parseServerFrame(JSON.parse(raw));

            if (!parsed.ok) {
                throw new Error('Mixed frame did not decode');
            }

            return 'event' in parsed.value
                ? { ...parsed.value, payload: EVENT_SCHEMAS['chat.event'].parse(parsed.value.payload) }
                : { ...parsed.value, result: REQUEST_SCHEMAS['server.ping'].result.parse('result' in parsed.value ? parsed.value.result : null) };
        });
    const mixedWitness = (protocol: Protocol): string => {
        const results = decodeMixed(protocol);
        globalThis.__ruimteProtocolResult = results;

        return String(results.length);
    };

    if (JSON.stringify(decodeMixed(before)) !== JSON.stringify(decodeMixed(after))) {
        throw new Error('Mixed output differs');
    }

    cases.push({ name: 'decode+validate/mixed-100', before: () => mixedWitness(before), after: () => mixedWitness(after) });

    return cases;
}

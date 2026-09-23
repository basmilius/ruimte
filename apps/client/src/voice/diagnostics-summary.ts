import type { ActionDomain } from '@ruimte/actions';
import type { VoiceSessionRecord } from '@/voice/diagnostics';

export interface VoiceLatency {
    count: number;
    medianMs: number | null;
    slowestMs: number | null;
}

export interface VoiceCount {
    name: string;
    count: number;
    /* A fraction from 0 to 1. */
    share: number;
}

export interface VoiceDiagnosticsSummary {
    sessions: number;
    requests: number;
    answered: number;
    calls: number;
    callsPerRequest: number | null;
    mostCallsInRequest: number;
    /* Finished calls refused or failed, as a fraction of every finished call; a confirmation question is not a failure. */
    failedShare: number | null;
    /* Every result other than `ok`, confirmation questions included. */
    results: VoiceCount[];
    actions: VoiceCount[];
    targets: {
        resolves: number;
        ambiguousShare: number | null;
        missingShare: number | null;
        noneShare: number | null;
        oneShare: number | null;
        severalShare: number | null;
    };
    latency: { response: VoiceLatency; call: VoiceLatency; answer: VoiceLatency };
    latest: { domains: ActionDomain[]; toolCount: number; toolBytes: number } | null;
}

export const median = (values: readonly number[]): number | null => {
    if (values.length === 0) {
        return null;
    }
    const sorted = values.toSorted((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};

const latencyOf = (values: readonly number[]): VoiceLatency => ({
    count: values.length,
    medianMs: median(values),
    slowestMs: values.length === 0 ? null : Math.max(...values)
});

const shareOf = (count: number, total: number): number | null => (total === 0 ? null : count / total);

const countsOf = (names: readonly string[], total: number): VoiceCount[] => {
    const counts = new Map<string, number>();
    for (const name of names) {
        counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts]
        .map(([name, count]) => ({ name, count, share: total === 0 ? 0 : count / total }))
        .toSorted((left, right) => right.count - left.count || left.name.localeCompare(right.name));
};

export const summarizeVoiceSessions = (sessions: readonly VoiceSessionRecord[]): VoiceDiagnosticsSummary => {
    const requests = sessions.flatMap((session) => session.requests);
    const calls = requests.flatMap((request) => request.calls);
    const finished = calls.filter((call) => call.result !== null);
    const notOk = finished.filter((call) => call.result !== 'ok');
    const failed = notOk.filter((call) => call.result !== 'needs_confirmation');
    const resolves = finished.flatMap((call) => (call.target ? [call.target] : []));
    const latest = sessions.at(-1);
    return {
        sessions: sessions.length,
        requests: requests.length,
        answered: requests.filter((request) => request.status === 'answered').length,
        calls: calls.length,
        callsPerRequest: shareOf(calls.length, requests.length),
        mostCallsInRequest: Math.max(0, ...requests.map((request) => request.calls.length)),
        failedShare: shareOf(failed.length, finished.length),
        results: countsOf(
            notOk.map((call) => call.result!),
            finished.length
        ),
        actions: countsOf(
            calls.map((call) => call.action ?? call.tool),
            calls.length
        ),
        targets: {
            resolves: resolves.length,
            ambiguousShare: shareOf(resolves.filter((target) => target.ambiguous > 0).length, resolves.length),
            missingShare: shareOf(resolves.filter((target) => target.missing > 0).length, resolves.length),
            noneShare: shareOf(resolves.filter((target) => target.found === 0).length, resolves.length),
            oneShare: shareOf(resolves.filter((target) => target.found === 1).length, resolves.length),
            severalShare: shareOf(resolves.filter((target) => target.found > 1).length, resolves.length)
        },
        latency: {
            response: latencyOf(requests.flatMap((request) => request.responses.map((response) => response.durationMs))),
            call: latencyOf(finished.flatMap((call) => (call.durationMs === null ? [] : [call.durationMs]))),
            answer: latencyOf(requests.flatMap((request) => (request.status === 'answered' && request.totalMs !== null ? [request.totalMs] : [])))
        },
        latest: latest ? { domains: latest.domains, toolCount: latest.toolCount, toolBytes: latest.toolBytes } : null
    };
};

import { describe, expect, test } from 'bun:test';
import type { ArtifactSummary } from '@ruimte/contracts';
import { dateGroupOf, defaultFilters, drawnKind, filtersChanged, groupByDate, matchesFilters } from './artifact-list.ts';

const NOW = new Date(2026, 9, 25, 12, 0).getTime();
const DAY = 24 * 60 * 60 * 1000;

function summary(
    id: string,
    patch: { at?: number; kind?: string; bytes?: number; projectId?: string; maker?: 'agent' | 'person'; title?: string } = {}
): ArtifactSummary {
    const at = patch.at ?? NOW;
    return {
        artifactId: id,
        projectId: patch.projectId ?? 'atlas',
        projectName: patch.projectId === 'beacon' ? 'beacon' : 'atlas',
        title: patch.title ?? `Report ${id}`,
        kind: patch.kind ?? 'report',
        createdAt: at,
        latest: {
            versionId: `${id}-v1`,
            number: 1,
            createdAt: at,
            files: [{ name: 'report.md', mime: 'text/markdown', size: patch.bytes ?? 10, sha256: 'aa' }],
            bytes: patch.bytes ?? 10,
            provenance: { maker: patch.maker ?? 'agent', machineId: 'mac' },
            copiedTo: []
        },
        versionCount: 1,
        totalBytes: patch.bytes ?? 10
    };
}

describe('the Output filters', () => {
    test('start on the project of the window and count as changed once anything else is picked', () => {
        const filters = defaultFilters('atlas');
        expect(filters.project).toBe('atlas');
        expect(filtersChanged(filters, 'atlas')).toBe(false);
        expect(filtersChanged({ ...filters, size: '1mb' }, 'atlas')).toBe(true);
    });

    test('narrow by project, kind, source, date and size together', () => {
        const filters = defaultFilters('atlas');
        expect(matchesFilters(summary('a'), filters, '', NOW)).toBe(true);
        expect(matchesFilters(summary('b', { projectId: 'beacon' }), filters, '', NOW)).toBe(false);
        expect(matchesFilters(summary('b', { projectId: 'beacon' }), { ...filters, project: 'all' }, '', NOW)).toBe(true);
        expect(matchesFilters(summary('c', { kind: 'image' }), { ...filters, kind: 'report' }, '', NOW)).toBe(false);
        expect(matchesFilters(summary('d', { maker: 'person' }), { ...filters, source: 'agent' }, '', NOW)).toBe(false);
        expect(matchesFilters(summary('e', { at: NOW - 10 * DAY }), { ...filters, date: 'week' }, '', NOW)).toBe(false);
        expect(matchesFilters(summary('e', { at: NOW - 40 * DAY }), { ...filters, date: 'older' }, '', NOW)).toBe(true);
        expect(matchesFilters(summary('f', { bytes: 1024 * 1024 }), { ...filters, size: '1mb' }, '', NOW)).toBe(false);
        expect(matchesFilters(summary('f', { bytes: 2 * 1024 * 1024 }), { ...filters, size: '1mb' }, '', NOW)).toBe(true);
    });

    test('a search matches the title whatever its case', () => {
        expect(matchesFilters(summary('a', { title: 'Morning summary' }), defaultFilters('atlas'), 'morning', NOW)).toBe(true);
        expect(matchesFilters(summary('a', { title: 'Morning summary' }), defaultFilters('atlas'), 'evening', NOW)).toBe(false);
    });

    test('a kind this version does not know counts as an export', () => {
        expect(drawnKind('hologram')).toBe('export');
        expect(matchesFilters(summary('a', { kind: 'hologram' }), { ...defaultFilters('atlas'), kind: 'export' }, '', NOW)).toBe(true);
    });
});

describe('the Output groups', () => {
    test('run from today over this week to earlier, newest first', () => {
        const groups = groupByDate([summary('old', { at: NOW - 20 * DAY }), summary('now'), summary('week', { at: NOW - 3 * DAY })], NOW);
        expect(groups.map((entry) => [entry.group, entry.artifacts.map((artifact) => artifact.artifactId)])).toEqual([
            ['today', ['now']],
            ['week', ['week']],
            ['earlier', ['old']]
        ]);
    });

    test('start today at the local midnight', () => {
        const midnight = new Date(2026, 9, 25, 0, 0).getTime();
        expect(dateGroupOf(midnight, NOW)).toBe('today');
        expect(dateGroupOf(midnight - 1, NOW)).toBe('week');
    });
});

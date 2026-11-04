import { ARTIFACT_KINDS, isKnownArtifactKind, type Artifact, type ArtifactSummary, type ArtifactVersion, type KnownArtifactKind } from '@ruimte/contracts';

export type ArtifactSource = 'agent' | 'person' | 'routine';
type DateFilter = 'all' | 'today' | 'week' | 'month' | 'older';
type SizeFilter = 'all' | '1mb' | '100mb' | '1gb';
type DateGroup = 'today' | 'week' | 'earlier';

/* What the panel narrows its list to. `all` lets every value through; `project` is a project id otherwise. */
export interface OutputFilters {
    project: string;
    kind: KnownArtifactKind | 'all';
    source: ArtifactSource | 'all';
    routine: string;
    date: DateFilter;
    size: SizeFilter;
}

export const ALL = 'all';
export const KINDS: readonly KnownArtifactKind[] = ARTIFACT_KINDS;
export const SOURCES: readonly ArtifactSource[] = ['agent', 'person', 'routine'];
export const DATES: readonly DateFilter[] = ['all', 'today', 'week', 'month', 'older'];
export const SIZES: readonly SizeFilter[] = ['all', '1mb', '100mb', '1gb'];

const DAY_MS = 24 * 60 * 60 * 1000;
const SIZE_FLOOR: Record<SizeFilter, number> = { all: 0, '1mb': 1024 * 1024, '100mb': 100 * 1024 * 1024, '1gb': 1024 * 1024 * 1024 };

/* The panel as it opens: the project in the window, everything else let through. */
export function defaultFilters(projectId: string | null): OutputFilters {
    return { project: projectId ?? ALL, kind: ALL, source: ALL, routine: ALL, date: ALL, size: ALL };
}

export function filtersChanged(filters: OutputFilters, projectId: string | null): boolean {
    const defaults = defaultFilters(projectId);
    return (Object.keys(defaults) as (keyof OutputFilters)[]).some((key) => filters[key] !== defaults[key]);
}

/* A kind this version does not know is drawn as an export: a file to keep, which every client can list. */
export function drawnKind(kind: string): KnownArtifactKind {
    return isKnownArtifactKind(kind) ? kind : 'export';
}

/* The local midnight that starts the day `now` is in. */
function startOfDay(now: number): number {
    const day = new Date(now);
    day.setHours(0, 0, 0, 0);
    return day.getTime();
}

export function matchesFilters(artifact: ArtifactSummary, filters: OutputFilters, query: string, now: number): boolean {
    const at = artifact.latest.createdAt;
    const today = startOfDay(now);
    if (filters.project !== ALL && artifact.projectId !== filters.project) {
        return false;
    }
    if (filters.kind !== ALL && drawnKind(artifact.kind) !== filters.kind) {
        return false;
    }
    if (filters.source !== ALL && artifact.latest.provenance.maker !== filters.source) {
        return false;
    }
    if (filters.routine !== ALL && artifact.latest.provenance.routineId !== filters.routine) {
        return false;
    }
    if (
        (filters.date === 'today' && at < today) ||
        (filters.date === 'week' && at < today - 6 * DAY_MS) ||
        (filters.date === 'month' && at < today - 29 * DAY_MS) ||
        (filters.date === 'older' && at >= today - 29 * DAY_MS)
    ) {
        return false;
    }
    if (filters.size !== ALL && artifact.totalBytes <= SIZE_FLOOR[filters.size]) {
        return false;
    }
    const needle = query.trim().toLowerCase();
    return needle === '' || artifact.title.toLowerCase().includes(needle) || (artifact.key ?? '').includes(needle);
}

export function dateGroupOf(at: number, now: number): DateGroup {
    const today = startOfDay(now);
    if (at >= today) {
        return 'today';
    }
    return at >= today - 6 * DAY_MS ? 'week' : 'earlier';
}

/* Newest first, in runs of the same group, so a heading goes above each run. */
export function groupByDate(artifacts: readonly ArtifactSummary[], now: number): { group: DateGroup; artifacts: ArtifactSummary[] }[] {
    const sorted = [...artifacts].sort((left, right) => right.latest.createdAt - left.latest.createdAt);
    const groups: { group: DateGroup; artifacts: ArtifactSummary[] }[] = [];
    for (const artifact of sorted) {
        const group = dateGroupOf(artifact.latest.createdAt, now);
        const last = groups.at(-1);
        if (last?.group === group) {
            last.artifacts.push(artifact);
        } else {
            groups.push({ group, artifacts: [artifact] });
        }
    }
    return groups;
}

/* The routines that made the latest version of something listed; empty until routines exist. */
export function routinesOf(artifacts: readonly ArtifactSummary[]): string[] {
    return [...new Set(artifacts.flatMap((artifact) => (artifact.latest.provenance.routineId === undefined ? [] : [artifact.latest.provenance.routineId])))];
}

/* A version Compare can put beside another: one file of text. */
export function comparable(version: ArtifactVersion): boolean {
    const file = version.files[0];
    return version.files.length === 1 && file !== undefined && isTextMime(file.mime);
}

export function isTextMime(mime: string): boolean {
    return mime.startsWith('text/') && mime !== 'text/html';
}

/* The name a copy starts with: a file's own name, or for several files a folder named after the artifact. */
export function suggestedCopyName(artifact: Artifact, version: ArtifactVersion): string {
    if (version.files.length === 1) {
        const name = version.files[0]!.name;
        return name.slice(name.lastIndexOf('/') + 1);
    }
    const slug = artifact.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return slug === '' ? 'output' : slug;
}

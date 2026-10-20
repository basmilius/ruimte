/* What a spoken name is held against: one candidate a name may pick, with the id an action takes. */
export interface VoiceNamed {
    id: string;
    name: string;
}

export type VoiceNameMatch<Target> = { status: 'found'; value: Target } | { status: 'missing' } | { status: 'ambiguous'; candidates: Target[] };

export interface VoiceNamesResolved<Target> {
    found: Target[];
    ambiguous: { name: string; candidates: Target[] }[];
    missing: string[];
}

/* Accents, case and punctuation are what speech recognition gets wrong first, so they never decide a match. */
export function normalizedName(value: string): string {
    return value
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLocaleLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

/* An exact name wins over a partial one, and more than one of either is the person's to choose. */
export function matchName<Target extends VoiceNamed>(
    name: string,
    targets: readonly Target[],
    label: (target: Target) => string = (target) => target.name
): VoiceNameMatch<Target> {
    const wanted = normalizedName(name);
    const exact = targets.filter((target) => normalizedName(label(target)) === wanted);
    if (exact.length === 1) {
        return { status: 'found', value: exact[0]! };
    }
    if (exact.length > 1) {
        return { status: 'ambiguous', candidates: exact };
    }
    if (wanted === '') {
        return { status: 'missing' };
    }
    const partial = targets.filter((target) => normalizedName(label(target)).includes(wanted) || wanted.includes(normalizedName(label(target))));
    if (partial.length === 1) {
        return { status: 'found', value: partial[0]! };
    }
    return partial.length > 1 ? { status: 'ambiguous', candidates: partial } : { status: 'missing' };
}

/* Every name on its own; a target two names found is found once. */
export function resolveNames<Target extends VoiceNamed>(names: readonly string[], match: (name: string) => VoiceNameMatch<Target>): VoiceNamesResolved<Target> {
    const found = new Map<string, Target>();
    const ambiguous: VoiceNamesResolved<Target>['ambiguous'] = [];
    const missing: string[] = [];
    for (const name of names) {
        const matched = match(name);
        if (matched.status === 'found') {
            found.set(matched.value.id, matched.value);
        } else if (matched.status === 'ambiguous') {
            ambiguous.push({ name, candidates: matched.candidates });
        } else {
            missing.push(name);
        }
    }
    return { found: [...found.values()], ambiguous, missing };
}

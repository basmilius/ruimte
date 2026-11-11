import { Package, PawPrint, type LucideIcon, type LucideProps } from 'lucide-react';
import { createElement, useSyncExternalStore } from 'react';

type IconMap = Record<string, LucideIcon>;

let iconMap: IconMap | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const glyphs = new Map<string, LucideIcon>();

// What the built-ins name, so a client with no other extension that names an icon never loads the set.
const SHIPPED: Readonly<Record<string, LucideIcon>> = { 'paw-print': PawPrint };

/*
 * The whole set is about 200 KB gzipped, so only a client with an extension that names an icon downloads it.
 * It comes from the CommonJS build, one module that shares nothing with the icons the app imports by name:
 * the ES build would tie each of those to this chunk and split them into a shared chunk per feature.
 */
function loadIconMap(): void {
    loading ??= import('lucide-react/dist/cjs/lucide-react.js').then(
        (module: { icons: IconMap }) => {
            iconMap = module.icons;

            for (const listener of listeners) {
                listener();
            }
        },
        () => {
            loading = null;
        }
    );
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    loadIconMap();

    return () => listeners.delete(listener);
}

/* `git-branch` as `GitBranch`, the key of Lucide's map. */
function keyOf(name: string): string {
    return name
        .split('-')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join('');
}

/*
 * The Lucide icon an extension names, drawn once the map has arrived. Until then an empty svg of the
 * same size and class holds its place, so nothing around it moves.
 */
export function namedIcon(name: string): LucideIcon {
    if (Object.hasOwn(SHIPPED, name)) {
        return SHIPPED[name]!;
    }

    const key = keyOf(name);
    const known = glyphs.get(key);

    if (known !== undefined) {
        return known;
    }

    const Glyph = ({ size = 24, className, ...rest }: LucideProps) => {
        const loaded = useSyncExternalStore(subscribe, () => iconMap);

        if (loaded !== null) {
            return createElement(loaded[key] ?? Package, { size, className, ...rest });
        }

        return <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden />;
    };

    glyphs.set(key, Glyph as unknown as LucideIcon);

    return Glyph as unknown as LucideIcon;
}

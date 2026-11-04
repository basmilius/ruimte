import { imageForDisplay } from '@adecore/agents-react/images';
import type { ProjectIcon, ProjectSummary } from '@ruimte/contracts';
import type { Transport } from '@/transport';
import { readResource } from '@/transport/byte-transfer';
import { readPiece } from '@/transport/piece';

export interface IconAppearance {
    color: string | null;
    black: boolean;
}

const EMPTY: IconAppearance = { color: null, black: false };
const cache = new WeakMap<Transport, Map<string, Promise<IconAppearance>>>();

export function iconAppearanceFromPixels(pixels: Uint8ClampedArray): IconAppearance {
    const colors = new Map<number, { weight: number; r: number; g: number; b: number }>();
    let visible = false;
    let black = true;
    for (let i = 0; i < pixels.length; i += 4) {
        const alpha = pixels[i + 3]! / 255;
        if (alpha < 0.1) {
            continue;
        }
        visible = true;
        const r = pixels[i]!;
        const g = pixels[i + 1]!;
        const b = pixels[i + 2]!;
        const high = Math.max(r, g, b);
        const low = Math.min(r, g, b);
        black &&= high <= 12;
        // Paper, monochrome lettering and transparent edges should not outweigh a logo's color.
        if (high - low < 24 || high < 40) {
            continue;
        }
        const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
        const weight = alpha * ((high - low) / high);
        const bucket = colors.get(key) ?? { weight: 0, r: 0, g: 0, b: 0 };
        bucket.weight += weight;
        bucket.r += r * weight;
        bucket.g += g * weight;
        bucket.b += b * weight;
        colors.set(key, bucket);
    }
    const dominant = [...colors.values()].sort((a, b) => b.weight - a.weight)[0];
    const color = dominant
        ? `#${[dominant.r, dominant.g, dominant.b]
              .map((channel) =>
                  Math.round(channel / dominant.weight)
                      .toString(16)
                      .padStart(2, '0')
              )
              .join('')}`
        : null;
    return { color, black: visible && black };
}

async function analyze(blob: Blob): Promise<IconAppearance> {
    const url = URL.createObjectURL(await imageForDisplay(blob));
    try {
        const image = new Image();
        image.src = url;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const context = canvas.getContext('2d');
        if (!context || !image.naturalWidth || !image.naturalHeight) {
            return EMPTY;
        }
        const scale = 64 / Math.max(image.naturalWidth, image.naturalHeight);
        context.drawImage(image, 0, 0, image.naturalWidth * scale, image.naturalHeight * scale);
        const appearance = iconAppearanceFromPixels(context.getImageData(0, 0, 64, 64).data);
        return { color: appearance.color, black: blob.type === 'image/svg+xml' && appearance.black };
    } finally {
        URL.revokeObjectURL(url);
    }
}

export function projectIconAppearance(
    transport: Transport,
    project: Pick<ProjectSummary, 'projectId'> & { icon: ProjectIcon },
    theme: 'light' | 'dark' = 'light'
): Promise<IconAppearance> {
    if (project.icon.kind !== 'image') {
        return Promise.resolve(EMPTY);
    }
    let entries = cache.get(transport);
    if (!entries) {
        entries = new Map();
        cache.set(transport, entries);
    }
    const key = JSON.stringify([project.projectId, project.icon.version, theme]);
    const cached = entries.get(key);
    if (cached) {
        return cached;
    }
    const result = readResource(
        (payload) => readPiece(transport, payload),
        { kind: 'projectIcon', projectId: project.projectId, theme },
        { maxBytes: 256 * 1024 }
    )
        .then(analyze)
        .catch(() => {
            entries.delete(key);
            return EMPTY;
        });
    if (entries.size >= 128) {
        entries.delete(entries.keys().next().value!);
    }
    entries.set(key, result);
    return result;
}

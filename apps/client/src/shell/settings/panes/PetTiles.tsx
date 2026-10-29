import { useEffect, useState, type ReactNode } from 'react';
import { usePrefersStill } from '@/pets/figure-support';
import { PetFigure } from '@/pets/PetFigure';
import { usePetLook } from '@/pets/use-pet-look';
import { useSettings } from '@/state/settings';

/* How long one turn of a tile takes: the thing it shows happens, holds a moment, and goes again. */
const TURN_MS = 2600;

/* The size of a tile, square beside the words of its row. */
const TILE = 44;

/* Where a figure in a tile stands: the line its feet rest on, from the bottom of the tile, so what stands on it sits in the middle. */
const GROUND = 12;

// A figure takes a world pixel a cell in a tile and its kids half of one, which a retina screen still draws sharp.
const FIGURE_CELL = 1;
const KID_CELL = 0.5;

/* How wide a figure and a kid are in a tile: the 26 columns a built-in figure fills. */
const FIGURE_WIDTH = 26 * FIGURE_CELL;
const KID_WIDTH = 26 * KID_CELL;

/* Where a row of things, each this wide with a gap between, starts so the row sits in the middle of a tile. */
function centered(widths: readonly number[], gap: number): number[] {
    const total = widths.reduce((sum, width) => sum + width, 0) + gap * (widths.length - 1);
    let left = Math.round((TILE - total) / 2);

    return widths.map((width) => {
        const at = left;
        left += width + gap;

        return at;
    });
}

/* The turn a tile is in, on a clock of its own while it shows; with reduced motion it holds the first. */
function useTurn(still: boolean, every = TURN_MS): number {
    const [turn, setTurn] = useState(0);

    useEffect(() => {
        if (still) {
            return;
        }

        const timer = setInterval(() => setTurn((current) => current + 1), every);

        return () => clearInterval(timer);
    }, [still, every]);

    return still ? 0 : turn;
}

/* A small square picture beside a setting, which shows what it does and takes nothing: no press, no focus, no reading. */
function Tile({ children }: { children: ReactNode }) {
    return (
        <span
            aria-hidden
            inert
            className="pointer-events-none relative block shrink-0 overflow-hidden rounded-lg border border-border bg-surface-idle select-none"
            style={{ width: TILE, height: TILE }}
        >
            <span className="absolute inset-x-0 bottom-0 border-t border-border bg-surface" style={{ height: GROUND }} />
            {children}
        </span>
    );
}

/* Standing on the tile's ground, its figure's left edge `left` from the tile's; the bottom row of its paint is the outline under its feet. */
function Standing({ left, cell = FIGURE_CELL, children }: { left: number; cell?: number; children: ReactNode }) {
    return (
        <span className="absolute" style={{ left, bottom: GROUND - cell }}>
            {children}
        </span>
    );
}

/* A pet at work, with the kids of its sub-agents behind it while Sub-agents is on, the group in the middle. */
export function SubagentsTile() {
    const look = usePetLook('claude', 'settings-tile');
    const kids = useSettings((s) => s.pets && s.petsSubagents);
    // The kids stand close behind one another and their pet, as on a node, so the three fit the tile.
    const lefts = centered(kids ? [KID_WIDTH, KID_WIDTH, FIGURE_WIDTH] : [FIGURE_WIDTH], -4);

    return (
        <Tile>
            {kids &&
                [0, 1].map((index) => (
                    <Standing key={index} left={lefts[index]} cell={KID_CELL}>
                        <PetFigure look={look} mood="working" crowded={false} cell={KID_CELL} />
                    </Standing>
                ))}
            <Standing left={lefts[lefts.length - 1]}>
                <PetFigure look={look} mood="working" crowded={false} cell={FIGURE_CELL} />
            </Standing>
        </Tile>
    );
}

/* The node a visitor drops by, a small card on the ground. */
const VISITED = { width: 12, height: 16 } as const;

/* A node, and every other turn a pet that drops by beside it while Visitor is on. */
export function VisitorTile() {
    const still = usePrefersStill();
    const turn = useTurn(still);
    const look = usePetLook(undefined, 'settings-tile');
    const visitor = useSettings((s) => s.petsVisitor);
    // The pair stands in the middle, the visitor's place kept while it is away, so the node never moves.
    const [petLeft, nodeLeft] = centered([FIGURE_WIDTH, VISITED.width], 2);

    return (
        <Tile>
            <span
                className="absolute rounded-sm border border-border bg-surface"
                style={{ left: nodeLeft, bottom: GROUND, width: VISITED.width, height: VISITED.height }}
            />
            {visitor && turn % 2 === 0 && (
                <Standing left={petLeft}>
                    <PetFigure look={look} mood="visiting" crowded={false} cell={FIGURE_CELL} beam="in" />
                </Standing>
            )}
        </Tile>
    );
}

/* A pet that comes and goes, in the way Teleport is set to, over and over: in on one half of a turn, out on the other. */
export function TeleportTile() {
    const still = usePrefersStill();
    const half = useTurn(still, TURN_MS / 2);
    const look = usePetLook('claude', 'settings-tile');
    const style = useSettings((s) => s.petsBeam);

    return (
        <Tile>
            {/* Every half turn, and another style, is a new figure, so its beam starts again. */}
            <Standing key={`${half}:${style}`} left={centered([FIGURE_WIDTH], 0)[0]}>
                <PetFigure look={look} mood="visiting" crowded={false} cell={FIGURE_CELL} beam={still ? undefined : half % 2 === 0 ? 'in' : 'out'} />
            </Standing>
        </Tile>
    );
}

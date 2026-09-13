import { useShallow } from 'zustand/react/shallow';
import { focusedCanvas, useCanvas } from '@/state/canvas';
import { isApplePlatform } from '@/desktop/bridge';
import { leaveNodeChordLabel } from '@/terminal/keymap';
import { Tooltip } from '@/ui/Tooltip';

const IN_BODY = 'flex h-8 items-center gap-1.5 rounded-lg bg-accent-soft px-2.5 text-xs font-medium text-accent';
const OUTSIDE = 'flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-text-muted';

/*
 * Where the keyboard is on a canvas: the canvas itself, or one node. A view of its own never gets
 * here, because the dock it sits in belongs to the canvas; there the way out is Escape and the
 * view's row in the sidebar. A terminal hands Escape to the program it runs, which is why the way
 * out is a chord there and plain Escape everywhere else.
 */
export function ModeChip() {
    const { mode, focusedTitle, focusedKind } = useCanvas(
        useShallow((s) => ({
            mode: s.mode.kind,
            focusedTitle: s.mode.kind === 'node' ? s.nodes[s.mode.nodeId]?.title : null,
            focusedKind: s.mode.kind === 'node' ? s.nodes[s.mode.nodeId]?.kind : null
        }))
    );

    return (
        <Tooltip
            label={
                mode !== 'node'
                    ? 'Keyboard goes to the canvas'
                    : focusedKind === 'terminal'
                      ? 'Keyboard goes to this terminal, Escape included. Click to return to the canvas.'
                      : 'Keyboard goes to this node. Click to return to the canvas.'
            }
            kbd={mode === 'node' ? (focusedKind === 'terminal' ? leaveNodeChordLabel(isApplePlatform()) : 'Esc') : undefined}
        >
            {mode === 'node' ? (
                <button
                    className={IN_BODY}
                    aria-label={`Leave ${focusedTitle ?? 'this node'} and return to the canvas`}
                    onClick={() => focusedCanvas().getState().exitNode()}
                >
                    <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                    <span className="max-w-40 truncate">{focusedTitle}</span>
                </button>
            ) : (
                <div className={OUTSIDE}>
                    <span className="h-1.5 w-1.5 rounded-full bg-text-faint" />
                    Canvas
                </div>
            )}
        </Tooltip>
    );
}

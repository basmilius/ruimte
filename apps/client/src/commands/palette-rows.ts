import i18next from 'i18next';
import { behaviorOf, type Command, type PaletteOptions } from '@/commands/behavior';
import { CommandMoment } from '@/commands/moment';
import { PALETTE_ORDER, type PaletteSlot } from '@/commands/palette-order';
import { commandIds, commandKey, commandSpec, isCommandId } from '@/commands/registry';

type RowProvider = (moment: CommandMoment) => Command[];

const providers = new Map<PaletteSlot, RowProvider>();

/* Rows a feature makes once per thing it holds (an agent CLI, a launch, a layout), each at its slot of `PALETTE_ORDER`. */
export function registerPaletteRows(added: Readonly<Partial<Record<PaletteSlot, RowProvider>>>): void {
    for (const [slot, provider] of Object.entries(added) as [PaletteSlot, RowProvider][]) {
        providers.set(slot, provider);
    }
}

export function clearPaletteRows(): void {
    providers.clear();
}

/* A row of the command table: its words and its key are the table's, what it does is the behavior's. */
function rowOf(id: string, run: () => void, options: PaletteOptions): Command {
    const spec = commandSpec(id);
    const shortcut = options.shortcut === undefined ? commandKey(id) : (options.shortcut ?? undefined);

    return {
        id,
        label: options.label ?? i18next.t(`shell:palette.commands.${spec.key}`, options.values ?? {}),
        ...(options.hint === undefined ? {} : { hint: options.hint }),
        ...(shortcut === undefined ? {} : { shortcut }),
        run
    };
}

function tableRow(id: string, moment: CommandMoment): Command | null {
    const behavior = behaviorOf(id);
    if (behavior === undefined || !commandSpec(id).palette) {
        return null;
    }
    const offer = behavior.offered?.(moment) ?? true;
    if (offer === false) {
        return null;
    }
    const run = behavior.afterClose
        ? () => {
              requestAnimationFrame(() => behavior.run());
          }
        : () => behavior.run();

    return rowOf(id, run, offer === true ? {} : offer);
}

/* Every row the palette offers besides the jumps, each only while it can act, in the order of `PALETTE_ORDER`. */
export function commandRows(moment: CommandMoment = new CommandMoment()): Command[] {
    const rows: Command[] = [];
    const placed = new Set<string>();
    const add = (row: Command | null): void => {
        if (row !== null) {
            rows.push(row);
        }
    };

    for (const entry of PALETTE_ORDER) {
        if (typeof entry !== 'string') {
            rows.push(...(providers.get(entry.rows)?.(moment) ?? []));
            continue;
        }

        placed.add(entry);

        if (isCommandId(entry)) {
            add(tableRow(entry, moment));
        }
    }

    for (const id of commandIds()) {
        if (!placed.has(id)) {
            add(tableRow(id, moment));
        }
    }

    return rows;
}

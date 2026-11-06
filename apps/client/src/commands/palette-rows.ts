import i18next from 'i18next';
import { behaviorOf, type Command, type PaletteOptions } from '@/commands/behavior';
import { CommandMoment } from '@/commands/moment';
import { commandIds, commandSpec } from '@/commands/registry';

type RowProvider = (moment: CommandMoment) => Command[];

const providers: RowProvider[] = [];

/* Rows a feature makes once per thing it holds (an agent CLI, a launch, a layout), beside the table's. */
export function registerPaletteRows(...added: readonly RowProvider[]): void {
    providers.push(...added);
}

/* A row of the command table: its words and its key are the table's, what it does is the behavior's. */
function rowOf(id: string, run: () => void, options: PaletteOptions): Command {
    const spec = commandSpec(id);
    const shortcut = options.shortcut === undefined ? spec.shortcut : (options.shortcut ?? undefined);

    return {
        id,
        label: options.label ?? i18next.t(`shell:palette.commands.${spec.key}`, options.values ?? {}),
        ...(options.hint === undefined ? {} : { hint: options.hint }),
        ...(shortcut === undefined ? {} : { shortcut }),
        run
    };
}

/* Every row the palette offers besides the jumps, each only while it can act. */
export function commandRows(moment: CommandMoment = new CommandMoment()): Command[] {
    const rows: Command[] = [];
    for (const id of commandIds()) {
        const behavior = behaviorOf(id);
        if (behavior === undefined || !commandSpec(id).palette) {
            continue;
        }
        const offer = behavior.offered?.(moment) ?? true;
        if (offer === false) {
            continue;
        }
        const run = behavior.afterClose
            ? () => {
                  requestAnimationFrame(() => behavior.run());
              }
            : () => behavior.run();
        rows.push(rowOf(id, run, offer === true ? {} : offer));
    }
    for (const provider of providers) {
        rows.push(...provider(moment));
    }

    return rows;
}

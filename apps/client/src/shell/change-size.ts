import i18next from 'i18next';
import { CHANGE_KINDS, type ChangeKind, type ChangeSplit } from '@ruimte/contracts';
import { formatNumber } from '@adecore/ui/format';

export interface SplitRow {
    kind: ChangeKind;
    label: string;
    added: number;
    deleted: number;
}

/* The kinds that hold any line, in the order of `CHANGE_KINDS`. */
export function splitRows(split: ChangeSplit): SplitRow[] {
    return CHANGE_KINDS.filter((kind) => split[kind].added + split[kind].deleted > 0).map((kind) => ({
        kind,
        label: i18next.t(`panels:git.changeKind.${kind}`),
        added: split[kind].added,
        deleted: split[kind].deleted
    }));
}

/* `Code +12 -3 · Tests +40 -0` for a hint that is one line; null when every line is code, which the total already says. */
export function splitSentence(split: ChangeSplit): string | null {
    const rows = splitRows(split);
    if (rows.every((row) => row.kind === 'code')) {
        return null;
    }
    return rows.map((row) => `${row.label} +${formatNumber(row.added)} -${formatNumber(row.deleted)}`).join(' · ');
}

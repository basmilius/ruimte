import { UI_GROUPS } from '@adecore/intelligent-ui';
import { uiReferenceText } from '@adecore/intelligent-ui/text';
import { RUIMTE_UI_FENCE } from '../chat/ui-fence.ts';
import { uiSourceExamples } from '../chat/ui-source-args.ts';

export const UI_SUMMARY = 'The catalog and syntax of fenced ruimte-ui blocks in replies; writes no project resource';

/*
 * The reference as `key\tvalue` lines like every other noun: the syntax, the example a line each, a
 * line per catalog group with its components, and the live data sources this machine reads.
 */
function uiDetail(): string[] {
    const [intro = '', ...groups] = uiReferenceText({ fenceLanguage: RUIMTE_UI_FENCE }).split('\n\n');
    const [syntax = '', ...example] = intro.split('\n').filter((line) => line !== 'Example:');
    const names = Object.keys(UI_GROUPS);
    const sources = uiSourceExamples(true)
        .map(({ name, args }) => `${name} ${args}`)
        .join(', ');
    return [
        'when\tWrite a block in your reply when it has structure a person scans or acts on; this is a reference, not a command',
        `syntax\t${syntax}`,
        ...example.map((line) => `example\t${line}`),
        ...groups.map((group, index) => `${names[index] ?? 'group'}\t${group.split('\n').join(' ')}`),
        `query\t$name = @Query("source", {args}), with these sources and arguments: ${sources}; database.query only in a project with connections. Queries only read, never start work or run writes`
    ];
}

export const UI_DETAIL: readonly string[] = uiDetail();

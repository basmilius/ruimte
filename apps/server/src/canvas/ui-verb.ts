import { UI_GROUPS, type UiGroupName } from '@adecore/intelligent-ui';
import { uiGroupReference, uiReferenceText } from '@adecore/intelligent-ui/text';
import { z } from 'zod';
import { RUIMTE_UI_FENCE } from '../chat/ui-fence.ts';
import { uiSourceExamples } from '../chat/ui-source-args.ts';
import { defineAction, type Action } from './verb.ts';

export const UI_SUMMARY = 'The catalog and syntax of fenced ruimte-ui blocks in replies, one group at a time; writes no project resource';

const GROUP_NAMES = Object.keys(UI_GROUPS) as UiGroupName[];

/* `Name: description. Props: a, b?.` as the catalog prints one component; a component without props ends at its description. */
const COMPONENT_LINE = /^(\w+): (.*?)(?: Props: (.*)\.)?$/;

/* The syntax and the example a line each, and the live data sources this machine reads; the components wait in `help ui <group>`. */
function uiDetail(): string[] {
    const intro = uiReferenceText({ fenceLanguage: RUIMTE_UI_FENCE }).split('\n\n')[0] ?? '';
    const [syntax = '', ...example] = intro.split('\n').filter((line) => line !== 'Example:');
    const sources = uiSourceExamples(true)
        .map(({ name, args }) => `${name} ${args}`)
        .join(', ');
    return [
        'when\tWrite a block in your reply when it has structure a person scans or acts on; this is a reference, not a command',
        `syntax\t${syntax}`,
        ...example.map((line) => `example\t${line}`),
        'detail\truimte-context help ui <group>\tthe components and rules of one group, also printed by ruimte-context ui <group>',
        `query\t$name = @Query("source", {args}), with these sources and arguments: ${sources}; database.query only in a project with connections. Queries only read, never start work or run writes`
    ];
}

function componentLine(line: string): string {
    const [, name, description, props] = COMPONENT_LINE.exec(line) ?? [];
    return name === undefined ? `component\t${line}` : `component\t${name}\t${props ?? '-'}\t${description}`;
}

function componentNames(group: UiGroupName): string[] {
    return uiGroupReference(group)
        .split('\n')
        .slice(2)
        .map((line) => line.split(':')[0] ?? line);
}

/* Host guidance supplements the catalog's group rules. */
const HOST_RULES: Partial<Record<UiGroupName, string>> = {
    data: 'Stat value and previous take numbers, e.g. value={42}; unit is a suffix. Use EntityList with Entry children for formatted text such as "21 min 38 sec".',
    content:
        'To show an image or model file of your own, attach it with ruimte-context chat attach --file <path>, which prints the id for attachment="<id>" on Image, Gallery and Compare, or on Model for a binary glTF, USDZ or STL',
    places: 'Ruimte does not look up addresses, so give lat and lon for every Place; an address may still be given as text, but a Place with only an address is not placed on the map'
};

/* The rules of a group, then a line per component with its props and what it is. */
function groupDetail(group: UiGroupName): string[] {
    const [, rules = '', ...components] = uiGroupReference(group).split('\n');
    const host = HOST_RULES[group];
    return [
        `rules\t${host === undefined ? rules : `${rules} ${host}`}`,
        'prints\tcomponent\tname\tprops\tdescription\tone row per component; a prop that ends in ? is optional, - is none',
        ...components.map(componentLine),
        ...(group === 'data'
            ? ['example\t<EntityList><Entry label="ci">21 min 38 sec</Entry><Entry label="far-future-clock">16 min 46 sec</Entry></EntityList>']
            : [])
    ];
}

function groupAction(group: UiGroupName): Action {
    const summary = `${UI_GROUPS[group].description} Components: ${componentNames(group).join(', ')}`;
    const detail = groupDetail(group);
    return defineAction('ui', {
        name: group,
        usage: '',
        summary,
        detail,
        positionals: z.tuple([]),
        flags: z.object({}),
        run: async () => [`about\t${summary}`, ...detail]
    });
}

export const UI_GROUP_ACTIONS: readonly Action[] = GROUP_NAMES.map(groupAction);

export const UI_DETAIL: readonly string[] = uiDetail();

import type { ActionOutput } from '@ruimte/actions';
import { z } from 'zod';
import { defineActionTool, jsonLines, runAction } from './action-tool.ts';
import { defineTool, defineToolkit, type ToolCall } from './tool.ts';
import { field, orNote } from './host.ts';

const UNSAVED_NOTE = "note\tThe file is open in an editor with changes that are not saved; these answers are about the editor's text, not the file on disk";

const LOOKUPS = ['hover', 'definition', 'references', 'supertypes', 'subtypes'] as const;

const FILE_ACTIONS = ['diagnostics', 'symbols', 'sql'] as const;

type Head = { path: string; unsaved: boolean; servers: { kind: string; state: string; message?: string }[] };

type Position = { path: string; line: number; column: number };

function headLines(head: Head): string[] {
    return [
        ...head.servers.map((server) => `server\t${server.kind}\t${server.state}${server.message ? `\t${field(server.message)}` : ''}`),
        ...(head.unsaved ? [UNSAVED_NOTE] : [])
    ];
}

function place(span: Position): string {
    return `${field(span.path)}:${span.line}:${span.column}`;
}

function diagnosticLine(diagnostic: ActionOutput<'language.diagnostics'>['diagnostics'][number]): string {
    return [
        'diagnostic',
        place(diagnostic),
        diagnostic.severity,
        diagnostic.source === null && diagnostic.code === null ? '-' : field([diagnostic.source ?? '-', diagnostic.code ?? '-'].join('/')),
        field(diagnostic.message)
    ].join('\t');
}

function locationsLines(answer: ActionOutput<'language.definition'>, none: string): string[] {
    return [
        ...headLines(answer),
        ...orNote(
            answer.locations.map((location) => `location\t${place(location)}\t${location.endLine}:${location.endColumn}`),
            none
        )
    ];
}

function typesLines(answer: ActionOutput<'language.supertypes'>, none: string): string[] {
    if (answer.type === null) {
        return [...headLines(answer), 'note\tThe language servers find no type at that place'];
    }

    return [
        ...headLines(answer),
        `type\t${field(answer.type.name)}\t${answer.type.kind}\t${answer.type.detail === null ? '-' : field(answer.type.detail)}`,
        ...orNote(
            answer.types.map((type) => `location\t${place(type)}\t${type.endLine}:${type.endColumn}\t${field(type.name)}`),
            none
        )
    ];
}

function wholeNumber(name: string) {
    const message = `${name} is a whole number from 1`;

    return z.number({ error: message }).int(message).min(1, message).describe('From 1');
}

const PATH_INPUT = z.string({ error: 'path needs the path of a file' }).trim().min(1, 'path needs the path of a file');

async function lookup(action: (typeof LOOKUPS)[number], position: Position, json: boolean, call: ToolCall): Promise<string[]> {
    switch (action) {
        case 'hover': {
            const answer = await runAction(call, 'language.hover', position);

            if (json) {
                return jsonLines(answer);
            }

            return [
                ...headLines(answer),
                ...(answer.contents === null
                    ? ['note\tThe language servers have nothing to say about that place']
                    : [`hover\t${place({ ...position, path: answer.path })}`, answer.contents])
            ];
        }

        case 'definition': {
            const answer = await runAction(call, 'language.definition', position);

            return json ? jsonLines(answer) : locationsLines(answer, 'The language servers know no definition of the name at that place');
        }

        case 'references': {
            const answer = await runAction(call, 'language.references', position);

            return json ? jsonLines(answer) : locationsLines(answer, 'The language servers know no use of the name at that place');
        }

        case 'supertypes': {
            const answer = await runAction(call, 'language.supertypes', position);

            return json ? jsonLines(answer) : typesLines(answer, 'The type has no supertype the language servers know');
        }

        case 'subtypes': {
            const answer = await runAction(call, 'language.subtypes', position);

            return json ? jsonLines(answer) : typesLines(answer, 'No type the language servers know extends or implements it');
        }
    }
}

const languageLookup = defineTool('language', {
    name: 'language_lookup',
    description: 'Asks the language server about the symbol at a line and column of a file.',
    annotations: { readOnly: true },
    input: z.object({
        action: z.enum(LOOKUPS, { error: `language_lookup needs action, one of ${LOOKUPS.join(', ')}` }),
        path: PATH_INPUT,
        line: wholeNumber('line'),
        column: wholeNumber('column'),
        json: z.boolean().optional()
    }),
    run: (input, call) => lookup(input.action, { path: input.path, line: input.line, column: input.column }, input.json === true, call)
});

function sqlLines(answer: ActionOutput<'language.sql'>): string[] {
    const connection = answer.connection;
    const missing =
        connection === null
            ? []
            : ['note\tNo schema snapshot of this connection was taken on this machine yet; a person opens the connection in the Databases panel of the app'];

    return [
        `source\t${answer.source}`,
        ...(connection === null
            ? []
            : [
                  `connection\t${field(connection.id)}\t${field(connection.name)}\t${connection.engine}`,
                  `database\t${answer.database === null ? '-' : field(answer.database)}`
              ]),
        ...(answer.dialect === null ? [] : [`dialect\t${answer.dialect}\t${answer.version ?? '-'}`]),
        ...(answer.snapshot === null ? missing : [`snapshot\t${field(answer.snapshot)}\t${answer.takenAt ?? '-'}`]),
        `check\t${answer.command}`,
        ...(answer.installed ? [] : ['note\tThe SQL server is not installed on this machine, so the command is not there yet; a person installs it in the app'])
    ];
}

async function fileAnswer(action: (typeof FILE_ACTIONS)[number], path: string, json: boolean, call: ToolCall): Promise<string[]> {
    switch (action) {
        case 'diagnostics': {
            const answer = await runAction(call, 'language.diagnostics', { path });

            if (json) {
                return jsonLines(answer);
            }

            return [...headLines(answer), ...orNote(answer.diagnostics.map(diagnosticLine), 'The language servers find no problem in this file')];
        }

        case 'symbols': {
            const answer = await runAction(call, 'language.symbols', { path });

            if (json) {
                return jsonLines(answer);
            }

            const symbols = answer.symbols.map((symbol) =>
                [
                    'symbol',
                    String(symbol.depth),
                    symbol.kind,
                    field(symbol.name),
                    `${symbol.line}:${symbol.column}`,
                    symbol.detail === null ? '-' : field(symbol.detail)
                ].join('\t')
            );

            return [...headLines(answer), ...orNote(symbols, 'The language servers find no symbol in this file')];
        }

        case 'sql': {
            const answer = await runAction(call, 'language.sql', { path });

            return json ? jsonLines(answer) : sqlLines(answer);
        }
    }
}

const languageFile = defineTool('language', {
    name: 'language_file',
    description: "Asks the language server for a file's diagnostics, symbols or SQL connection.",
    annotations: { readOnly: true },
    input: z.object({
        action: z.enum(FILE_ACTIONS, { error: `language_file needs action, one of ${FILE_ACTIONS.join(', ')}` }),
        path: PATH_INPUT,
        json: z.boolean().optional()
    }),
    run: (input, call) => fileAnswer(input.action, input.path, input.json === true, call)
});

const languageProblems = defineActionTool('language', {
    name: 'language_problems',
    action: 'language.problems',
    description: 'Reads what the last whole-project language check found.',
    annotations: { readOnly: true },
    input: z.object({
        path: z.string().trim().min(1, 'path takes the path of a file, or leave it out').optional().describe('A file whose servers start first'),
        json: z.boolean().optional()
    }),
    async run(input, call) {
        const answer = await runAction(call, 'language.problems', { path: input.path ?? null });

        if (input.json === true) {
            return jsonLines(answer);
        }

        const withheld = answer.withheld === 1 ? '1 file' : `${answer.withheld} files`;

        return [
            ...answer.servers.map((server) => `server\t${server.kind}\t${server.process}`),
            ...(answer.pulled === false ? ['note\tNo whole-project check ran yet; a person starts one from the Problems panel'] : []),
            ...orNote(answer.diagnostics.map(diagnosticLine), 'The language servers find no problem in the project'),
            ...(answer.truncated ? ['note\tOnly the first 500 problems are listed; language_file with action diagnostics reads one file whole'] : []),
            ...(answer.withheld > 0 ? [`note\tWithheld from ${withheld} read against a connection turned off for agents`] : [])
        ];
    }
});

export const languageToolkit = defineToolkit('language', [languageLookup, languageFile, languageProblems]);

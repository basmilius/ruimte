import { describe, expect, test } from 'bun:test';
import { EmptySchema } from '@adecore/agent-contracts/protocol';
import { EVENT_SCHEMAS, REQUEST_SCHEMAS } from './index.ts';
import * as language from './language.ts';
import * as sql from './sql-binding.ts';

describe('language wire', () => {
    test('released language methods pass the request table, while commands and version zero are refused', () => {
        const base = { projectId: 'p', path: 'src/a.ts', params: { position: { line: 0, character: 0 } } };
        const schema = REQUEST_SCHEMAS['language.request'].payload;
        // Released request methods remain accepted even when the production allowlist changes.
        for (const method of [
            'textDocument/completion',
            'completionItem/resolve',
            'textDocument/hover',
            'textDocument/signatureHelp',
            'textDocument/definition',
            'textDocument/declaration',
            'textDocument/typeDefinition',
            'textDocument/implementation',
            'textDocument/references',
            'textDocument/documentHighlight',
            'textDocument/documentSymbol',
            'textDocument/prepareRename',
            'textDocument/rename',
            'textDocument/codeAction',
            'codeAction/resolve',
            'textDocument/codeLens',
            'codeLens/resolve',
            'textDocument/formatting',
            'textDocument/rangeFormatting',
            'textDocument/onTypeFormatting',
            'textDocument/foldingRange',
            'textDocument/selectionRange',
            'textDocument/semanticTokens/full',
            'textDocument/semanticTokens/full/delta',
            'textDocument/semanticTokens/range',
            'textDocument/inlayHint',
            'inlayHint/resolve',
            'textDocument/prepareCallHierarchy',
            'callHierarchy/incomingCalls',
            'callHierarchy/outgoingCalls',
            'workspace/symbol',
            'textDocument/documentLink',
            'documentLink/resolve',
            'textDocument/documentColor',
            'textDocument/colorPresentation',
            'textDocument/linkedEditingRange',
            'textDocument/prepareTypeHierarchy',
            'typeHierarchy/supertypes',
            'typeHierarchy/subtypes',
            'textDocument/rangesFormatting',
            'textDocument/inlineCompletion',
            'textDocument/willSaveWaitUntil'
        ] as const) {
            expect(schema.parse({ ...base, method })).toEqual({ ...base, method });
            const payload = { ...base, method, version: 1, server: 'typescript' };
            expect(schema.parse(payload)).toEqual(payload);
        }
        expect(schema.safeParse({ ...base, method: 'workspace/executeCommand' }).success).toBe(false);
        expect(schema.safeParse({ ...base, method: 'textDocument/hover', version: 0 }).success).toBe(false);
    });

    test('a change names its base version and carries at least one entry', () => {
        const change = { projectId: 'p', path: 'a.ts', baseVersion: 1, changes: [{ text: 'x' }] };
        expect(language.LanguageDocumentChangePayloadSchema.safeParse(change).success).toBe(true);
        expect(language.LanguageDocumentChangePayloadSchema.safeParse({ ...change, changes: [] }).success).toBe(false);
        expect(language.LanguageDocumentChangePayloadSchema.safeParse({ ...change, baseVersion: undefined }).success).toBe(false);
    });

    test('language routes bind their payloads, replies and events to the owning schemas', () => {
        const requests = {
            'language.status': [language.LanguageStatusPayloadSchema, language.LanguageStatusResultSchema],
            'language.install': [language.LanguageInstallPayloadSchema, language.LanguageServerStatusResultSchema],
            'language.prefer': [language.LanguagePreferPayloadSchema, language.LanguageServerStatusResultSchema],
            'language.rollback': [language.LanguageRollbackPayloadSchema, language.LanguageServerStatusResultSchema],
            'language.restart': [language.LanguageServerTargetPayloadSchema, language.LanguageServerStatusResultSchema],
            'language.log': [language.LanguageServerTargetPayloadSchema, language.LanguageLogResultSchema],
            'language.worktreeBuild': [language.LanguageWorktreeBuildPayloadSchema, language.LanguageStatusResultSchema],
            'language.custom.list': [EmptySchema, language.LanguageCustomListResultSchema],
            'language.custom.save': [language.LanguageCustomSavePayloadSchema, language.LanguageCustomSaveResultSchema],
            'language.custom.remove': [language.LanguageCustomRemovePayloadSchema, EmptySchema],
            'language.custom.check': [language.LanguageCustomCheckPayloadSchema, language.LanguageCustomCheckResultSchema],
            'language.document.open': [language.LanguageDocumentOpenPayloadSchema, language.LanguageDocumentOpenResultSchema],
            'language.document.change': [language.LanguageDocumentChangePayloadSchema, language.LanguageDocumentChangeResultSchema],
            'language.document.close': [language.LanguageDocumentTargetPayloadSchema, EmptySchema],
            'language.request': [language.LanguageRequestPayloadSchema, language.LanguageRequestResultSchema],
            'language.command': [language.LanguageCommandPayloadSchema, language.LanguageCommandResultSchema],
            'language.edit.answer': [language.LanguageEditAnswerPayloadSchema, EmptySchema],
            'language.willSave': [language.LanguageWillSavePayloadSchema, EmptySchema],
            'language.workspaceProblems': [language.LanguageWorkspaceProblemsPayloadSchema, language.LanguageWorkspaceProblemsResultSchema],
            'language.messageAnswer': [language.LanguageMessageAnswerPayloadSchema, EmptySchema],
            'language.trace': [language.LanguageTracePayloadSchema, language.LanguageServerStatusResultSchema],
            'language.sql': [sql.LanguageSqlPayloadSchema, sql.LanguageSqlStateSchema],
            'language.sql.bind': [sql.LanguageSqlBindPayloadSchema, sql.LanguageSqlStateSchema]
        };
        for (const [type, [payload, result]] of Object.entries(requests)) {
            const binding = REQUEST_SCHEMAS[type as keyof typeof requests];
            expect(binding.payload).toBe(payload);
            expect(binding.result).toBe(result);
        }
        const events = {
            'language.diagnostics': language.LanguageDiagnosticsEventSchema,
            'language.status': language.LanguageStatusEventSchema,
            'language.custom.changed': language.LanguageCustomChangedEventSchema,
            'language.providers': language.LanguageProvidersEventSchema,
            'language.edit': language.LanguageEditEventSchema,
            'language.message': language.LanguageMessageEventSchema,
            'language.messageClosed': language.LanguageMessageClosedEventSchema,
            'language.show': language.LanguageShowEventSchema,
            'language.sql.changed': sql.LanguageSqlChangedEventSchema
        };
        for (const [type, schema] of Object.entries(events)) {
            expect(EVENT_SCHEMAS[type as keyof typeof events]).toBe(schema);
        }
    });

    test('a server of a person needs something to serve, and a language server id is a kind or a custom one', () => {
        const server = { name: 'Zig', command: 'zls', args: [], languages: [], patterns: [] };
        expect(language.CustomLanguageServerInputSchema.safeParse(server).success).toBe(false);
        expect(language.CustomLanguageServerInputSchema.safeParse({ ...server, patterns: ['*.zig'] }).success).toBe(true);
        expect(language.CustomLanguageServerInputSchema.safeParse({ ...server, languages: ['zig'], name: '  ' }).success).toBe(false);
        expect(language.LanguageServerIdSchema.safeParse('typescript').success).toBe(true);
        expect(language.LanguageServerIdSchema.safeParse('custom:abc').success).toBe(true);
        expect(language.LanguageServerIdSchema.safeParse('nonsense').success).toBe(false);
    });

    test('a status carries which of two servers the machine uses, and whether a build has none to install, only when it has something to say', () => {
        const base = { server: 'php-native', state: 'not-installed', version: '', documents: 0 };
        expect(language.LanguageServerStatusSchema.safeParse(base).success).toBe(true);
        expect(language.LanguageServerStatusSchema.safeParse({ ...base, chosen: true, unavailable: true }).success).toBe(true);
        expect(language.LanguagePreferPayloadSchema.safeParse({ server: 'php' }).success).toBe(true);
        expect(language.LanguagePreferPayloadSchema.safeParse({ server: 'custom:a' }).success).toBe(false);
    });

    test('a save reason is one of the three LSP reasons and a trace value one of three', () => {
        const target = { projectId: 'p', path: 'a.ts' };
        expect(language.LanguageWillSavePayloadSchema.safeParse({ ...target, reason: 3 }).success).toBe(true);
        expect(language.LanguageWillSavePayloadSchema.safeParse({ ...target, reason: 4 }).success).toBe(false);
        expect(language.LanguageTracePayloadSchema.safeParse({ projectId: 'p', server: 'css', value: 'verbose' }).success).toBe(true);
        expect(language.LanguageTracePayloadSchema.safeParse({ projectId: 'p', server: 'css', value: 'loud' }).success).toBe(false);
    });

    test('a shown document has a path or a url, never both and never neither', () => {
        const show = { projectId: 'p', server: 'css', title: 'CSS' };
        expect(language.LanguageShowEventSchema.safeParse({ ...show, path: 'a.css' }).success).toBe(true);
        expect(language.LanguageShowEventSchema.safeParse({ ...show, url: 'https://ruimte.app' }).success).toBe(true);
        expect(language.LanguageShowEventSchema.safeParse(show).success).toBe(false);
        expect(language.LanguageShowEventSchema.safeParse({ ...show, path: 'a.css', url: 'https://ruimte.app' }).success).toBe(false);
    });

    test('a message carries actions only for a request, and a log line keeps its source and level optional', () => {
        const message = { projectId: 'p', messageId: 'message-1', server: 'css', title: 'CSS', type: 1, message: 'Broken' };
        expect(language.LanguageMessageEventSchema.safeParse(message).success).toBe(true);
        expect(language.LanguageMessageEventSchema.safeParse({ ...message, actions: [] }).success).toBe(true);
        expect(language.LanguageLogLineSchema.safeParse({ at: 1, stream: 'server', text: 'x' }).success).toBe(true);
        expect(language.LanguageLogLineSchema.safeParse({ at: 1, stream: 'server', text: 'x', source: 'trace', level: 'debug' }).success).toBe(true);
    });
});

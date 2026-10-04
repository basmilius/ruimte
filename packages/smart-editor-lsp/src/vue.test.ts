import { describe, expect, it } from 'bun:test';
import { bridgeVueTypeScript, isVueExpression, vueServerOrder } from './vue.ts';
import { flush, sessionWith } from './test-transport.ts';

describe('Vue bridge', () => {
    it('forwards Vue 3.3 positional notification tuples and unwraps the tsserver body', async () => {
        const ts = await sessionWith({ executeCommandProvider: { commands: ['typescript.tsserverRequest'] } });
        const vue = await sessionWith();
        const bridge = bridgeVueTypeScript(vue.session, ts.session);
        vue.transport.emit({ jsonrpc: '2.0', method: 'tsserver/request', params: [[7, '_vue:projectInfo', { file: '/work/app.vue' }]] });
        await flush();
        expect(ts.transport.request('workspace/executeCommand')?.params).toEqual({
            command: 'typescript.tsserverRequest',
            arguments: ['_vue:projectInfo', { file: '/work/app.vue' }, { isAsync: false, lowPriority: true }]
        });
        ts.transport.respond('workspace/executeCommand', { body: { configFileName: '/work/tsconfig.json' } });
        await flush();
        expect(vue.transport.sent).toContainEqual({ jsonrpc: '2.0', method: 'tsserver/response', params: [[7, { configFileName: '/work/tsconfig.json' }]] });
        bridge.dispose();
        await Promise.all([ts.session.shutdown(), vue.session.shutdown()]);
    });

    it('answers null on a failed TypeScript request so Vue can finish', async () => {
        const ts = await sessionWith({ executeCommandProvider: { commands: [] } });
        const vue = await sessionWith();
        const errors: Error[] = [];
        vue.session.onError((error) => errors.push(error));
        const bridge = bridgeVueTypeScript(vue.session, ts.session);
        vue.transport.emit({ jsonrpc: '2.0', method: 'tsserver/request', params: [[9, '_vue:projectInfo', {}]] });
        await flush();
        ts.transport.emit({ jsonrpc: '2.0', id: ts.transport.request('workspace/executeCommand').id, error: { code: -32603, message: 'Plugin unavailable' } });
        await flush();
        expect(vue.transport.sent).toContainEqual({ jsonrpc: '2.0', method: 'tsserver/response', params: [[9, null]] });
        expect(errors[0]?.message).toBe('Plugin unavailable');
        bridge.dispose();
        await Promise.all([ts.session.shutdown(), vue.session.shutdown()]);
    });
});

const component = ['<template>', '  <p :title="label">{{ count }}</p>', '</template>', '<script setup lang="ts">', 'const count = 1;', '</script>'].join('\n');

describe('Vue routing', () => {
    it('finds the expressions of a template and the body of a script', () => {
        expect(isVueExpression(component, component.indexOf('count }}'))).toBe(true);
        expect(isVueExpression(component, component.indexOf('label'))).toBe(true);
        expect(isVueExpression(component, component.indexOf('const count'))).toBe(true);
        expect(isVueExpression(component, component.indexOf('<p'))).toBe(false);
        expect(isVueExpression(component, component.indexOf('<script'))).toBe(false);
    });

    it('asks TypeScript first inside an expression and for hints, Vue everywhere else', () => {
        const inTemplate = { line: 1, character: 4 };
        const inExpression = { line: 1, character: 18 };
        expect(vueServerOrder('textDocument/hover', component, { position: inTemplate })).toEqual(['vue', 'typescript']);
        expect(vueServerOrder('textDocument/hover', component, { position: inExpression })).toEqual(['typescript', 'vue']);
        expect(vueServerOrder('textDocument/codeAction', component, { range: { start: inExpression, end: inExpression } })).toEqual(['typescript', 'vue']);
        expect(vueServerOrder('textDocument/inlayHint', component, { range: { start: inTemplate, end: inTemplate } })).toEqual(['typescript', 'vue']);
        expect(vueServerOrder('textDocument/documentSymbol', component, {})).toEqual(['vue', 'typescript']);
        expect(vueServerOrder('textDocument/hover', component, { position: { line: 99, character: 0 } })).toEqual(['vue', 'typescript']);
    });
});

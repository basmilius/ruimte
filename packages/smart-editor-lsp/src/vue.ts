import { offsetAt } from './edits.ts';
import type { Disposable } from './protocol.ts';
import type { LspSession } from './session.ts';

/*
 * Vue's server leaves TypeScript to a tsserver of its own project and asks for it with
 * `tsserver/request` notifications, which this relays to the TypeScript server's
 * `typescript.tsserverRequest` command. Attach it before the Vue session initializes, and open each
 * `.vue` document in both sessions, TypeScript first.
 */
export function bridgeVueTypeScript(vue: LspSession, typescript: LspSession): Disposable {
    let disposed = false;
    const subscription = vue.onNotification('tsserver/request', async (params) => {
        // vscode-jsonrpc encodes this single positional argument as an outer array.
        const positional = Array.isArray(params) && params.length === 1 && Array.isArray(params[0]);
        const tuple = positional ? params[0] : params;
        if (!Array.isArray(tuple) || tuple.length !== 3) {
            throw new Error('Invalid Vue tsserver/request notification');
        }
        const [id, command, args] = tuple as [number, string, unknown];
        let body: unknown = null;
        try {
            const response = await typescript.executeCommand<{ body?: unknown }>('typescript.tsserverRequest', [
                command,
                args,
                { isAsync: false, lowPriority: true }
            ]);
            body = response?.body ?? null;
        } catch (error) {
            vue.connection.reportError(error);
        }
        // Vue keeps the request pending until it gets an answer, a null one included.
        if (!disposed && !vue.connection.isClosed) {
            await vue.connection.notify('tsserver/response', positional ? [[id, body]] : [id, body]);
        }
    });
    return {
        dispose() {
            disposed = true;
            subscription.dispose();
        }
    };
}

export type VueServer = 'vue' | 'typescript';

/* A `<script>` body, or the expression of an interpolation or a `v-` / `:` / `@` attribute: the places TypeScript knows more than Vue does. */
export function isVueExpression(text: string, offset: number): boolean {
    const script = /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi;
    for (let match = script.exec(text); match; match = script.exec(text)) {
        if (offset > match.index + match[0].indexOf('>') && offset < match.index + match[0].lastIndexOf('</')) {
            return true;
        }
    }
    const expressions = /\{\{[\s\S]*?\}\}|(?:[:@][\w.:-]+|v-[\w.:-]+)\s*=\s*(?:"[^"]*"|'[^']*')/g;
    for (let match = expressions.exec(text); match; match = expressions.exec(text)) {
        if (offset >= match.index && offset <= match.index + match[0].length) {
            return true;
        }
    }
    return false;
}

function paramsOffset(text: string, params: unknown): number | null {
    if (!params || typeof params !== 'object') {
        return null;
    }
    const position =
        'position' in params
            ? params.position
            : 'range' in params && params.range && typeof params.range === 'object' && 'start' in params.range
              ? params.range.start
              : null;
    if (!position || typeof position !== 'object') {
        return null;
    }
    try {
        return offsetAt(text, position as { line: number; character: number });
    } catch {
        return null;
    }
}

/*
 * Which of the two servers of a Vue document to ask first, the other being the fallback when the
 * first does not support the method. Vue answers template markup, HTML and CSS; TypeScript answers
 * a script and the expressions of a template, and the inlay hints of all of it.
 */
export function vueServerOrder(method: string, text: string, params: unknown): [VueServer, VueServer] {
    const offset = paramsOffset(text, params);
    const typescriptFirst = method === 'textDocument/inlayHint' || (offset !== null && isVueExpression(text, offset));
    return typescriptFirst ? ['typescript', 'vue'] : ['vue', 'typescript'];
}

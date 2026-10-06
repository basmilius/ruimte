import { describe, expect, test } from 'bun:test';
import type { SymbolKind } from '@adecore/lsp';
import { declaredNameOf, isTypeName, linkTypeNames, placesOfName } from '@adecore/editor-react/models';

const range = (line: number) => ({ start: { line, character: 0 }, end: { line, character: 3 } });
const symbol = (name: string, kind: SymbolKind, uri: string, containerName?: string) => ({ name, kind, containerName, location: { uri, range: range(3) } });

describe('type names in a snippet', () => {
    test('are the names with a capital and a lowercase letter', () => {
        expect(['IssueTicketsMessage', 'Foo', 'T', 'DEFAULT_WEIGHTS', 'foo', 'Foo_Bar'].map(isTypeName)).toEqual([true, true, false, false, false, true]);
    });

    test('become links when they are a whole token, and nothing else does', () => {
        const html =
            '<span class="line"><span style="color:#a">final</span><span style="color:#b">IssueTicketsMessage</span><span style="color:#c"> implements </span><span>MessageInterface</span><span>"Quoted"</span><span>// Not a Name</span></span>';
        const linked = linkTypeNames(html);
        expect(linked.match(/data-symbol="([^"]+)"/g)).toEqual(['data-symbol="IssueTicketsMessage"', 'data-symbol="MessageInterface"']);
        expect(linked).toContain('hover:underline');
        expect(linked).toContain('"Quoted"');
    });

    test('has a declared name when the signature declares one', () => {
        expect(declaredNameOf('final class IssueTicketsMessage implements MessageInterface { }')).toBe('IssueTicketsMessage');
        expect(declaredNameOf('const weights: Weights = {}')).toBe('weights');
        expect(declaredNameOf('(method) Foo.bar(): void')).toBeNull();
        expect(declaredNameOf('public function __construct(Foo $foo)')).toBe('__construct');
    });
});

describe('where a name leads', () => {
    const uriA = 'file:///a/Message.php';
    const uriB = 'file:///b/Message.php';

    test('keeps the exact name, types ahead of the rest', () => {
        const places = placesOfName([symbol('Message', 5, uriA), symbol('MessageBus', 5, uriB), symbol('Message', 13, uriB)], 'Message', '');
        expect(places.map((place) => place.uri)).toEqual([uriA]);
        expect(placesOfName([symbol('Message', 13, uriB)], 'Message', '').map((place) => place.uri)).toEqual([uriB]);
    });

    test('takes the one whose namespace the file names when there are several', () => {
        const result = [symbol('Message', 5, uriA, 'App\\Chat'), symbol('Message', 5, uriB, 'Vendor\\Mail')];
        expect(placesOfName(result, 'Message', 'use Vendor\\Mail;').map((place) => place.uri)).toEqual([uriB]);
        expect(placesOfName(result, 'Message', '')).toHaveLength(2);
    });

    test('has none for no result, and a place on the first line for a symbol without a range', () => {
        expect(placesOfName(null, 'Message', '')).toEqual([]);
        const bare = [{ name: 'Message', kind: 5 as SymbolKind, location: { uri: uriA } }];
        expect(placesOfName(bare, 'Message', '')[0]!.range.start.line).toBe(0);
    });
});

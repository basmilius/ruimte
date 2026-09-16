import { describe, expect, test } from 'bun:test';
import { DiagramContentSchema, diagramProblemIn } from '@ruimte/contracts';
import { exampleDiagram } from './example';

describe('the example diagram', () => {
    test('is a document the daemon takes: it parses and nothing in it points nowhere', () => {
        const content = exampleDiagram('Flow');
        expect(DiagramContentSchema.parse(content)).toEqual(content);
        expect(diagramProblemIn(content)).toBeNull();
        expect(content.meta.title).toBe('Flow');
    });
});

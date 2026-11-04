import { describe, expect, test } from 'bun:test';
import { DiagramDocumentSchema } from '@adecore/diagram/protocol';
import { DrawingDocumentSchema } from '@adecore/drawing/protocol';
import { PlanSchema } from '@adecore/plan/protocol';
import * as diagram from './diagram-host.ts';
import * as drawing from './drawing-host.ts';
import { EVENT_SCHEMAS, REQUEST_SCHEMAS } from './index.ts';
import * as plan from './plan-host.ts';

describe('Adecore schemas in the Ruimte wire', () => {
    test('uses the shared instances inside application request and event envelopes', () => {
        expect(drawing.DrawingDocumentSchema).toBe(DrawingDocumentSchema);
        expect(diagram.DiagramDocumentSchema).toBe(DiagramDocumentSchema);
        expect(plan.PlanSchema).toBe(PlanSchema);
        expect(REQUEST_SCHEMAS['drawing.save'].payload).toBe(drawing.DrawingSavePayloadSchema);
        expect(REQUEST_SCHEMAS['diagram.save'].payload).toBe(diagram.DiagramSavePayloadSchema);
        expect(REQUEST_SCHEMAS['plan.apply'].payload).toBe(plan.PlanApplyPayloadSchema);
        expect(EVENT_SCHEMAS['drawing.changed']).toBe(drawing.DrawingChangedEventSchema);
        expect(EVENT_SCHEMAS['diagram.changed']).toBe(diagram.DiagramChangedEventSchema);
        expect(EVENT_SCHEMAS['plan.changed']).toBe(plan.PlanChangedEventSchema);
    });
});

import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import * as drawing from './drawing-host.ts';
import * as oldDrawing from './drawing.ts';
import * as diagram from './diagram-host.ts';
import * as oldDiagram from './diagram.ts';
import * as plan from './plan-host.ts';
import * as oldPlan from './plan.ts';
import { DrawingDocumentSchema } from '@adecore/drawing/protocol';
import { DiagramDocumentSchema } from '@adecore/diagram/protocol';
import { PlanSchema } from '@adecore/plan/protocol';
import { EVENT_SCHEMAS, REQUEST_SCHEMAS } from './index.ts';

describe('Adecore schemas in the Ruimte wire', () => {
    test('preserves the existing persisted and wire schema constraints', () => {
        const pairs = [
            [drawing.DrawingContentSchema, oldDrawing.DrawingContentSchema],
            [drawing.DrawingDocumentSchema, oldDrawing.DrawingDocumentSchema],
            [drawing.DrawingSavePayloadSchema, oldDrawing.DrawingSavePayloadSchema],
            [drawing.DrawingChangedEventSchema, oldDrawing.DrawingChangedEventSchema],
            [diagram.DiagramContentSchema, oldDiagram.DiagramContentSchema],
            [diagram.DiagramDocumentSchema, oldDiagram.DiagramDocumentSchema],
            [diagram.DiagramSavePayloadSchema, oldDiagram.DiagramSavePayloadSchema],
            [diagram.DiagramChangedEventSchema, oldDiagram.DiagramChangedEventSchema],
            [plan.PlanSchema, oldPlan.PlanSchema],
            [plan.PlanPersonOpSchema, oldPlan.PlanPersonOpSchema],
            [plan.PlanApplyPayloadSchema, oldPlan.PlanApplyPayloadSchema],
            [plan.PlanChangedEventSchema, oldPlan.PlanChangedEventSchema]
        ] as const;
        for (const [current, previous] of pairs) {
            expect(z.toJSONSchema(current)).toEqual(z.toJSONSchema(previous));
        }
    });

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

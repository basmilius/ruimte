import { describe, expect, test } from 'bun:test';
import { renderDistanceFrom, rendersAtZoom } from '@/canvas/render-distance';

describe('render distance', () => {
    test('standard draws live from 0.4 up, on the line included', () => {
        expect(rendersAtZoom('standard', 0.5)).toBe(true);
        expect(rendersAtZoom('standard', 0.4)).toBe(true);
        expect(rendersAtZoom('standard', 0.39)).toBe(false);
    });

    test('far draws live from 0.2 up', () => {
        expect(rendersAtZoom('far', 0.3)).toBe(true);
        expect(rendersAtZoom('far', 0.2)).toBe(true);
        expect(rendersAtZoom('far', 0.19)).toBe(false);
    });

    test('unlimited draws live at every zoom the camera reaches', () => {
        expect(rendersAtZoom('unlimited', 0.1)).toBe(true);
        expect(rendersAtZoom('unlimited', 2)).toBe(true);
    });

    test('an unknown or missing value reads as standard', () => {
        expect(renderDistanceFrom(undefined)).toBe('standard');
        expect(renderDistanceFrom('near')).toBe('standard');
        expect(renderDistanceFrom(0.2)).toBe('standard');
        expect(renderDistanceFrom('far')).toBe('far');
        expect(renderDistanceFrom('unlimited')).toBe('unlimited');
    });
});

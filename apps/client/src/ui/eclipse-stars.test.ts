import { describe, expect, test } from 'bun:test';
import { starsOf } from './eclipse-stars';

describe('the stars of a scene', () => {
    test('lie the same way for the same seed and differently for another', () => {
        expect(starsOf(46, 7)).toEqual(starsOf(46, 7));
        expect(starsOf(46, 7)).not.toEqual(starsOf(46, 8));
        expect(starsOf(46, 7)).toHaveLength(46);
    });

    test('stay inside the scene, in whole pixels, with a cycle already under way', () => {
        for (const star of starsOf(200, 3)) {
            expect(star.left).toBeGreaterThanOrEqual(0);
            expect(star.left).toBeLessThanOrEqual(100);
            expect(star.top).toBeGreaterThanOrEqual(0);
            expect(star.top).toBeLessThanOrEqual(100);
            expect([1, 2]).toContain(star.size);
            expect(star.delay).toBeLessThanOrEqual(0);
            expect(star.alpha).toBeGreaterThanOrEqual(0.18);
            expect(star.alpha).toBeLessThanOrEqual(0.5);
        }
    });

    test('twinkle over four to seven seconds, and glint over six to nine', () => {
        const stars = starsOf(400, 11);
        for (const star of stars) {
            const [low, high] = star.glint ? [6, 9] : [4, 7];
            expect(star.duration).toBeGreaterThanOrEqual(low);
            expect(star.duration).toBeLessThanOrEqual(high);
        }
        const glints = stars.filter((star) => star.glint).length / stars.length;
        expect(glints).toBeGreaterThan(0.1);
        expect(glints).toBeLessThan(0.3);
    });
});

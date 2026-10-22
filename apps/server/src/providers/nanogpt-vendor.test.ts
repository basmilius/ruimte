import { describe, expect, test } from 'bun:test';
import { nanoGptVendorOf } from './nanogpt-vendor.ts';

describe('who made a NanoGPT model', () => {
    test('is the publisher before the slash, under one name however it is spelled', () => {
        expect(nanoGptVendorOf('z-ai/glm-5.3')).toBe('Z.ai');
        expect(nanoGptVendorOf('moonshotai/kimi-k2.7-code')).toBe('Moonshot AI');
        expect(nanoGptVendorOf('deepseek/deepseek-v4-pro')).toBe('DeepSeek');
        expect(nanoGptVendorOf('deepseek-ai/DeepSeek-V3.1')).toBe('DeepSeek');
        expect(nanoGptVendorOf('meta-llama/llama-4')).toBe('Meta');
        expect(nanoGptVendorOf('meta/llama-4')).toBe('Meta');
        expect(nanoGptVendorOf('TheDrummer/Cydonia')).toBe('TheDrummer');
        expect(nanoGptVendorOf('thedrummer/Cydonia')).toBe('TheDrummer');
    });

    test('is the publisher as written for one nobody knows, which is a community fine-tune as often as a lab', () => {
        expect(nanoGptVendorOf('Steelskull/Some-Tune')).toBe('Steelskull');
        expect(nanoGptVendorOf('newlab/model')).toBe('newlab');
    });

    test('is the family for a slug with no publisher, and NanoGPT for its own names', () => {
        expect(nanoGptVendorOf('gemma-4-31b-it-fabled')).toBe('Google');
        expect(nanoGptVendorOf('Qwen3.5-27B-Queen-Derestricted')).toBe('Qwen');
        expect(nanoGptVendorOf('deepseek-chat')).toBe('DeepSeek');
        expect(nanoGptVendorOf('GLM-4.6-Derestricted-v5')).toBe('Z.ai');
        expect(nanoGptVendorOf('auto-model-premium')).toBe('NanoGPT');
        expect(nanoGptVendorOf('hermes-high')).toBe('NanoGPT');
    });

    test('is Other when nothing says', () => {
        expect(nanoGptVendorOf('mystery-model-7')).toBe('Other');
    });
});

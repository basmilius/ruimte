import manifest from '../manifest.json';
import { defineBuiltIn, defineTheme } from '@/extensions/internal';
import { UMBRA } from '@extensions/theme-umbra/client/theme';

defineBuiltIn(manifest, () => [defineTheme(UMBRA)]);

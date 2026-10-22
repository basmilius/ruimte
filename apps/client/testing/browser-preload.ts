import { compileReactSourcesAhead } from './react-compiler-transform';

// The fixture bundles the compiled client (`browser-fixture.ts`); compiled here, the first test that bundles it does not pay within its own timeout.
await compileReactSourcesAhead();

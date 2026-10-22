import { describe, expect, test } from 'bun:test';
import { changeKindOf, splitChanges } from './change-split.ts';

describe('changeKindOf', () => {
    test('lockfiles, generated names, minified files and protobuf output are generated', () => {
        for (const path of [
            'bun.lock',
            'apps/site/package-lock.json',
            'yarn.lock',
            'pnpm-lock.yaml',
            'Cargo.lock',
            'go.sum',
            'apps/ios/App.xcworkspace/xcshareddata/swiftpm/Package.resolved',
            'src/api.generated.ts',
            'src/schema.gen.go',
            'public/vendor.min.js',
            'public/site.min.css',
            'proto/user.pb.go',
            'proto/user_pb2.py',
            'proto/user_pb2_grpc.py',
            'web/user_pb.js',
            'web/user_grpc_pb.d.ts',
            'Sources/User.pb.swift',
            // A lockfile under a test folder is still a lockfile.
            'tests/fixtures/app/yarn.lock'
        ]) {
            expect([path, changeKindOf(path)]).toEqual([path, 'generated']);
        }
    });

    test('mock folders, fixtures, test data, snapshots and mock files are mocks', () => {
        for (const path of [
            'src/__mocks__/fs.ts',
            'test/fixtures/repo.json',
            'pkg/parser/testdata/input.txt',
            'src/__snapshots__/view.test.tsx.snap',
            'src/view.test.tsx.snap',
            'src/api.mock.ts',
            'Tests/Fixtures/reply.json'
        ]) {
            expect([path, changeKindOf(path)]).toEqual([path, 'mocks']);
        }
    });

    test('test names in each language and test folders are tests', () => {
        for (const path of [
            'apps/server/src/git/github.test.ts',
            'src/view.spec.tsx',
            'pkg/parser/parser_test.go',
            'tools/test_split.py',
            'src/main/java/app/ParserTest.java',
            'Sources/AppTests/ParserTests.swift',
            'tests/helpers.php',
            'src/__tests__/render.tsx',
            'spec/models/user_spec.rb'
        ]) {
            expect([path, changeKindOf(path)]).toEqual([path, 'tests']);
        }
    });

    test('everything else is code, names that only look alike included', () => {
        for (const path of [
            'src/index.ts',
            'src/latest.ts',
            'src/Contest.java',
            'docs/testing.md',
            'src/generator.ts',
            'src/mockup.tsx',
            'README.md',
            'src/attest.py'
        ]) {
            expect([path, changeKindOf(path)]).toEqual([path, 'code']);
        }
    });
});

describe('splitChanges', () => {
    test('sums each file into its kind, so the kinds add up to the total', () => {
        const files = [
            { path: 'src/a.ts', added: 10, deleted: 2 },
            { path: 'src/b.ts', added: 5, deleted: 0 },
            { path: 'src/a.test.ts', added: 30, deleted: 4 },
            { path: 'src/__mocks__/a.ts', added: 3, deleted: 1 },
            { path: 'bun.lock', added: 200, deleted: 180 }
        ];
        expect(splitChanges(files)).toEqual({
            code: { added: 15, deleted: 2 },
            tests: { added: 30, deleted: 4 },
            mocks: { added: 3, deleted: 1 },
            generated: { added: 200, deleted: 180 }
        });
    });

    test('no files is every kind at zero', () => {
        expect(splitChanges([])).toEqual({
            code: { added: 0, deleted: 0 },
            tests: { added: 0, deleted: 0 },
            mocks: { added: 0, deleted: 0 },
            generated: { added: 0, deleted: 0 }
        });
    });
});

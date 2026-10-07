import { describe, expect, test } from 'bun:test';
import { ProjectSqlSchema } from './project.ts';
import { DatabaseSnapshotRefreshPayloadSchema, LanguageSqlBindPayloadSchema, LanguageSqlStateSchema } from './sql-binding.ts';

describe('SQL choices', () => {
    test('a file reads a connection and maybe a database, or none at all', () => {
        expect(ProjectSqlSchema.safeParse({ default: { connectionId: 'shop' }, files: { 'a.sql': { connectionId: null } } }).success).toBe(true);
        expect(ProjectSqlSchema.safeParse({ files: { 'a.sql': { connectionId: 'shop', database: 'orders' } } }).success).toBe(true);
        expect(ProjectSqlSchema.safeParse({ files: { 'a.sql': { connectionId: '' } } }).success).toBe(false);
        expect(ProjectSqlSchema.safeParse({ files: { 'a.sql': { connectionId: 'shop', database: '' } } }).success).toBe(false);
    });

    test('a choice without a path is the project default, and null takes one away', () => {
        expect(LanguageSqlBindPayloadSchema.safeParse({ projectId: 'p', binding: { connectionId: 'shop' } }).success).toBe(true);
        expect(LanguageSqlBindPayloadSchema.safeParse({ projectId: 'p', path: 'a.sql', binding: null }).success).toBe(true);
        expect(LanguageSqlBindPayloadSchema.safeParse({ projectId: 'p', path: '', binding: null }).success).toBe(false);
    });

    test('a refresh names a connection and a schema only when it narrows to them', () => {
        expect(DatabaseSnapshotRefreshPayloadSchema.safeParse({ projectId: 'p' }).success).toBe(true);
        expect(DatabaseSnapshotRefreshPayloadSchema.safeParse({ projectId: 'p', connectionId: 'shop', schema: 'orders' }).success).toBe(true);
    });

    test('a snapshot of every database of a connection has no database', () => {
        const snapshot = {
            connectionId: 'shop',
            database: null,
            dialect: 'mariadb',
            version: '11.4.2-MariaDB',
            takenAt: '2026-10-07T09:00:00.000Z',
            tables: 3
        };
        expect(LanguageSqlStateSchema.safeParse({ sql: {}, snapshots: [snapshot] }).success).toBe(true);
    });
});

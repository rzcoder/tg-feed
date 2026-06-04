import { describe, expect, it } from 'vitest';
import {
  EXPORT_SCHEMA_VERSION,
  exportFileSchema,
  exportRequestSchema,
  exportedInlineFilterSchema,
  exportedLibraryFilterSchema,
  exportedSubscriptionSchema,
  importRequestSchema,
  wipeRequestSchema,
} from './exportImport.js';
import { FILTER_RULE_TYPES } from './filters.js';

// Export/import drops or rejects any rule type missing from these hand-listed unions; keep them in lockstep.
const coveredRuleTypes = (union: { options: readonly unknown[] }): string[] =>
  union.options.map((o) => (o as { shape: { ruleType: { value: string } } }).shape.ruleType.value);

describe('exported filter unions', () => {
  it('exportedInlineFilterSchema has a branch for every rule type', () => {
    expect(coveredRuleTypes(exportedInlineFilterSchema).sort()).toEqual(
      [...FILTER_RULE_TYPES].sort(),
    );
  });

  it('exportedLibraryFilterSchema has a branch for every rule type', () => {
    expect(coveredRuleTypes(exportedLibraryFilterSchema).sort()).toEqual(
      [...FILTER_RULE_TYPES].sort(),
    );
  });
});

describe('exportFileSchema', () => {
  const minimalEnvelope = {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: '2026-05-10T00:00:00.000Z',
    appVersion: '0.1.0',
  };

  it('accepts the minimal envelope (no sections)', () => {
    expect(exportFileSchema.safeParse(minimalEnvelope).success).toBe(true);
  });

  it('rejects when schemaVersion is missing', () => {
    const { schemaVersion: _drop, ...rest } = minimalEnvelope;
    expect(exportFileSchema.safeParse(rest).success).toBe(false);
  });

  it('accepts all four sections together', () => {
    const result = exportFileSchema.safeParse({
      ...minimalEnvelope,
      destinations: [{ name: 'main', chatId: '-1001', note: null }],
      libraryFilters: [
        { name: 'short text', ruleType: 'min-length', params: { min: 50 }, mode: 'include' },
      ],
      subscriptions: [
        {
          sourceChatId: '-1002',
          sourceTitle: 'Source',
          handle: '@src',
          enabled: true,
          destination: { chatId: '-1001', name: 'main' },
          inlineFilters: [],
          libraryFilters: [],
        },
      ],
      appSettings: { delayMs: 8000, albumDebounceMs: 2000 },
    });
    expect(result.success).toBe(true);
  });

  it('rejects an inline filter whose params do not match its ruleType', () => {
    const result = exportFileSchema.safeParse({
      ...minimalEnvelope,
      subscriptions: [
        {
          sourceChatId: '-1002',
          sourceTitle: 'Source',
          handle: null,
          enabled: true,
          destination: null,
          inlineFilters: [
            // 'min-length' expects { min }, not { value }.
            { ruleType: 'min-length', params: { value: 'oops' }, enabled: true, mode: 'include' },
          ],
          libraryFilters: [],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('accepts a subscription with a null destination (detached)', () => {
    expect(
      exportedSubscriptionSchema.safeParse({
        sourceChatId: '-1002',
        sourceTitle: 'Source',
        handle: null,
        enabled: true,
        destination: null,
        inlineFilters: [],
        libraryFilters: [],
      }).success,
    ).toBe(true);
  });
});

describe('exportRequestSchema', () => {
  it('rejects an empty sections array', () => {
    expect(exportRequestSchema.safeParse({ sections: [] }).success).toBe(false);
  });

  it('rejects an unknown section', () => {
    expect(exportRequestSchema.safeParse({ sections: ['unknown'] }).success).toBe(false);
  });

  it('accepts known section subsets', () => {
    expect(
      exportRequestSchema.safeParse({ sections: ['subscriptions', 'destinations'] }).success,
    ).toBe(true);
  });
});

describe('importRequestSchema', () => {
  const data = {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: '2026-05-10T00:00:00.000Z',
    appVersion: '0.1.0',
  };

  it('rejects an unknown conflict strategy', () => {
    expect(
      importRequestSchema.safeParse({
        sections: ['destinations'],
        conflictStrategy: 'force',
        data,
      }).success,
    ).toBe(false);
  });

  it('accepts skip and replace', () => {
    for (const conflictStrategy of ['skip', 'replace'] as const) {
      expect(
        importRequestSchema.safeParse({
          sections: ['destinations'],
          conflictStrategy,
          data,
        }).success,
      ).toBe(true);
    }
  });
});

describe('wipeRequestSchema', () => {
  it('rejects appSettings (only data tables are wipeable)', () => {
    expect(wipeRequestSchema.safeParse({ sections: ['appSettings'] }).success).toBe(false);
  });

  it('accepts subscriptions/destinations/libraryFilters', () => {
    expect(
      wipeRequestSchema.safeParse({
        sections: ['subscriptions', 'destinations', 'libraryFilters'],
      }).success,
    ).toBe(true);
  });
});

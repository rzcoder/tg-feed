import { describe, expect, it } from 'vitest';
import { describeFilter } from './describeFilter';

describe('describeFilter', () => {
  it('formats text-contains without prefix in include mode (default)', () => {
    expect(
      describeFilter({
        ruleType: 'text-contains',
        params: { value: 'rust', caseInsensitive: true },
      }),
    ).toBe('contains "rust" (case-insensitive)');
  });

  it('prefixes with "Exclude: " when mode is exclude', () => {
    expect(
      describeFilter({
        ruleType: 'text-contains',
        params: { value: 'rust', caseInsensitive: true },
        mode: 'exclude',
      }),
    ).toBe('Exclude: contains "rust" (case-insensitive)');
  });

  it('applies the prefix to every rule type', () => {
    const cases = [
      [
        { ruleType: 'has-media', params: { required: true }, mode: 'exclude' },
        'Exclude: must have media',
      ],
      [{ ruleType: 'min-length', params: { min: 50 }, mode: 'exclude' }, 'Exclude: min length 50'],
      [
        { ruleType: 'sender-allowlist', params: { usernames: ['alice'] }, mode: 'exclude' },
        'Exclude: sender ∈ [alice]',
      ],
      [
        { ruleType: 'text-regex', params: { pattern: 'foo', flags: 'i' }, mode: 'exclude' },
        'Exclude: /foo/i',
      ],
    ] as const;
    for (const [input, expected] of cases) {
      expect(describeFilter(input)).toBe(expected);
    }
  });

  it('formats link-prefix with a friendly scope label when not "both"', () => {
    expect(
      describeFilter({ ruleType: 'link-prefix', params: { value: 't.me/', scope: 'entity' } }),
    ).toBe('link starts with "t.me/" in link targets');
  });

  it('omits the scope suffix for link-prefix when scope is "both"', () => {
    expect(
      describeFilter({ ruleType: 'link-prefix', params: { value: 't.me/', scope: 'both' } }),
    ).toBe('link starts with "t.me/"');
  });

  it('appends "+ links" when a text filter opts into entities', () => {
    expect(
      describeFilter({
        ruleType: 'text-contains',
        params: { value: 'rust', caseInsensitive: true, includeEntities: true },
      }),
    ).toBe('contains "rust" (case-insensitive) + links');
  });

  it('describes a has-media count comparison', () => {
    expect(
      describeFilter({
        ruleType: 'has-media',
        params: { required: true, countOp: 'gt', count: 3 },
      }),
    ).toBe('must have media (count > 3)');
  });
});

// Add a rule: drop a file here and add one register(...) line below.
import { createRegistry, type FilterRegistry } from '../registry.js';
import { hasMediaRule } from './hasMedia.js';
import { minLengthRule } from './minLength.js';
import { senderAllowlistRule } from './senderAllowlist.js';
import { textContainsRule } from './textContains.js';
import { textExcludesRule } from './textExcludes.js';
import { textRegexRule } from './textRegex.js';

export function createDefaultRegistry(): FilterRegistry {
  const registry = createRegistry();
  registry.register(textContainsRule);
  registry.register(textExcludesRule);
  registry.register(textRegexRule);
  registry.register(hasMediaRule);
  registry.register(minLengthRule);
  registry.register(senderAllowlistRule);
  return registry;
}

/**
 * @tg-feed/shared — DTOs, zod schemas, and cross-package types.
 *
 * Anything that crosses the network boundary between server and web
 * lives here so both sides import from a single source of truth.
 */

export const SHARED_PACKAGE_VERSION = '0.1.0';

export * from './filters.js';

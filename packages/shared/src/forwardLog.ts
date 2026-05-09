/**
 * Forward log status tuple.
 *
 * Lives in shared so the wire DTO (`forwardLogEntryDtoSchema`) and the
 * server's drizzle schema (`forwardLog.status` column) refer to the same
 * literal set. The CHECK constraint on the DB column is defined inline in
 * the server schema and must be updated in lockstep with this tuple.
 */
export const FORWARD_LOG_STATUSES = ['sent', 'filtered', 'flood_wait', 'failed'] as const;
export type ForwardLogStatus = (typeof FORWARD_LOG_STATUSES)[number];

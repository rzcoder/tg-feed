// Keep in lockstep with the DB CHECK constraint on forwardLog.status (defined inline in the server schema).
export const FORWARD_LOG_STATUSES = ['sent', 'filtered', 'flood_wait', 'failed'] as const;
export type ForwardLogStatus = (typeof FORWARD_LOG_STATUSES)[number];

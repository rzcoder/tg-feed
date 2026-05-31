/**
 * "Xs ago" / "Xm ago" / "Xh ago" / "Xd ago" relative formatter.
 * Matches the design's `formatRelative`.
 */
export function formatRelative(ageSec: number): string {
  if (ageSec < 60) return `${Math.max(1, Math.round(ageSec))}s ago`;
  if (ageSec < 3600) return `${Math.round(ageSec / 60)}m ago`;
  if (ageSec < 86400) return `${Math.round(ageSec / 3600)}h ago`;
  return `${Math.round(ageSec / 86400)}d ago`;
}

export function formatAbsoluteTime(ageSec: number): string {
  const d = new Date(Date.now() - ageSec * 1000);
  return d.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

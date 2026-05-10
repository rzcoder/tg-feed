# Known issues / deferred work

Tracking real bugs and known limitations that aren't (yet) in the main
`PLAN.md` checklist. Each entry includes context, impact, and a sketch of
the fix so a future change can pick it up without rediscovering the
problem.

---

## Missed messages while offline (no catch-up after disconnect / restart)

**Status:** open. Documented in [apps/server/src/index.ts](../apps/server/src/index.ts)
(boot warning) and [apps/server/src/forwarding/floodwait.ts](../apps/server/src/forwarding/floodwait.ts).

### Symptom

Any Telegram message that arrives in a subscribed channel while the server
is disconnected — including the few seconds during a restart — is **never
forwarded**. The listener picks up only events that happen after the
gramjs client has fully reconnected.

### Root cause

gramjs 2.26.x ships `client.catchUp()` as a TODO stub:

```js
// node_modules/telegram/client/updates.js
function catchUp() {
  // TODO
}
```

It does not call `updates.getDifference` (the MTProto API for fetching
updates the client missed while offline) on its own, and the auto-reconnect
loop only restores the transport. Consequently the project cannot rely on
gramjs to backfill missed events.

The boot path now logs this explicitly:

> `Telegram catch-up is not available in gramjs 2.26.x; messages
 delivered while offline will be missed`

### Why this matters

For a personal forwarder this is the difference between "restart is
transparent" and "restart silently drops the last 30 seconds of channel
output." The longer the disconnect, the wider the gap.

### Proposed fix

Custom catch-up driven by per-subscription `last_seen_message_id`:

1. **Schema:** add `last_seen_message_id TEXT` to `subscriptions`. Nullable
   until the first successful forward (no historical scan on first add).
2. **Writer:** when the forwarder records `status='sent'`, also bump
   `subscriptions.last_seen_message_id` to `MAX(existing, sourceMessageId)`
   in the same transaction. (Same approach already used for clearing
   `forwarding_restricted_at`.)
3. **Boot backfill:** during `resolveSubscriptionsOnStartup`, for each
   subscription with a non-null `last_seen_message_id` and `enabled=true`,
   page through `client.invoke(new Api.messages.GetHistory({ peer, minId,
limit }))` collecting ids strictly greater than the watermark.
4. **Replay:** push the collected `RawForwardJob`s through the existing
   debouncer → pipeline. The forwarder dedupe-on-write semantics (writing
   one `forward_log` row per source id) keep accidental double-forwards
   from re-sending if a backfill races a reconnect.
5. **Rate-limit awareness:** boot backfill must be sequential
   (already the case for `getEntity` warm-ups in
   [tg/subscriptions.ts](../apps/server/src/tg/subscriptions.ts)) and
   honour FloodWait via the existing `extractRateLimit` path so a long
   downtime doesn't trigger a per-method throttle.

### Out of scope for the fix

- Edited / deleted messages while offline. `getHistory` returns the
  current state; if a sender edits and then deletes within the gap we
  won't see anything. Acceptable for a forwarder.
- Channel-specific cursors (PTS / channel `pts`) — a per-subscription
  message-id watermark is good enough since we only forward, not mirror.

---

## Other deferred items

These ride along here so the issue list is one stop, not scattered:

- **`floodSleepThreshold` left at gramjs default (60 s).** gramjs sleeps
  internally for FloodWait/SlowMode `≤ 60 s` before raising, which makes
  `flood_wait` log rows under-report. Setting `floodSleepThreshold: 0` in
  [tg/client.ts](../apps/server/src/tg/client.ts) would push every wait
  through project logic, at the cost of more `flood_wait` log spam. Decide
  once we have real telemetry.
- **`EditedMessage` not handled.** Edits in the source aren't reflected
  in the destination. Requires a new gramjs handler, plus mapping
  `sourceMessageId → destMessageId` (lookup `forward_log`) and an
  `editMessage` call. Listed here so it doesn't get rediscovered as a bug.
- **`CHAT_FORWARDS_RESTRICTED` has no copy-fallback.** We tag the
  subscription with `forwarding_restricted_at` and surface a UI badge,
  but `messages.sendMessage` / `messages.sendMedia` could still relay
  text + reuploaded media. Out of scope until the badge proves
  insufficient.

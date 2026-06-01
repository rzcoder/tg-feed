import { describe, it, expect, vi } from 'vitest';
import { createLogger } from '../lib/logger.js';
import { createForumTopicLister, type ForumTopicListerClient } from './forumTopics.js';

const logger = createLogger({ silent: true });

function makeClient(invoke: ForumTopicListerClient['invoke']): ForumTopicListerClient {
  return { invoke };
}

describe('createForumTopicLister', () => {
  it('maps live topics and skips deleted ones', async () => {
    const invoke = vi.fn().mockResolvedValue({
      topics: [
        { className: 'ForumTopic', id: 1, title: 'General' },
        { className: 'ForumTopic', id: 42, title: 'Releases' },
        { className: 'ForumTopicDeleted', id: 99 },
        { className: 'ForumTopic', id: 43, title: 'Random' },
      ],
    }) as unknown as ForumTopicListerClient['invoke'];

    const result = await createForumTopicLister(makeClient(invoke), logger)('-1001234567890');

    expect(result.isForum).toBe(true);
    expect(result.topics).toEqual([
      { id: '1', title: 'General' },
      { id: '42', title: 'Releases' },
      { id: '43', title: 'Random' },
    ]);
  });

  it('returns isForum:false on error (e.g. non-forum chat)', async () => {
    const invoke = vi
      .fn()
      .mockRejectedValue(
        new Error('CHANNEL_FORUM_MISSING'),
      ) as unknown as ForumTopicListerClient['invoke'];

    const result = await createForumTopicLister(makeClient(invoke), logger)('-1001234567890');

    expect(result).toEqual({ isForum: false, topics: [] });
  });
});

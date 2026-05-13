import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ActivityRow, type ActivityEvent } from './ActivityRow';

const NOW = Date.now();

function event(overrides: Partial<ActivityEvent>): ActivityEvent {
  return {
    id: 'test',
    kind: 'sent',
    subscriptionId: 1,
    subscriptionTitle: 'Anthropic',
    sourceHandle: '@anthropic_ai',
    destinationLabel: 'ops',
    occurredAt: NOW - 30_000,
    ...overrides,
  };
}

describe('ActivityRow', () => {
  it('renders sent event with sub title and source/dest', () => {
    render(<ActivityRow event={event({ kind: 'sent' })} />);
    expect(screen.getByText('Anthropic')).toBeInTheDocument();
    expect(screen.getByText('@anthropic_ai')).toBeInTheDocument();
    expect(screen.getByText('ops')).toBeInTheDocument();
    expect(screen.getByText(/sent/i)).toBeInTheDocument();
  });

  it('renders album-aware "forwarded N messages" for sent with destMessageCount > 1', () => {
    render(<ActivityRow event={event({ kind: 'sent', destMessageCount: 3 })} />);
    expect(screen.getByText(/forwarded 3 messages/i)).toBeInTheDocument();
  });

  it('renders filtered event with reason chips', () => {
    render(
      <ActivityRow
        event={event({
          kind: 'filtered',
          reasons: ['text-excludes: matched "show hn"'],
        })}
      />,
    );
    expect(screen.getByText(/text-excludes: matched/)).toBeInTheDocument();
    expect(screen.getByText(/filtered/i)).toBeInTheDocument();
  });

  it('parses library: prefix into a Library chip + filter name', () => {
    render(
      <ActivityRow
        event={event({
          kind: 'filtered',
          reasons: ['library:No #реклама: text-excludes: matched #реклама'],
        })}
      />,
    );
    expect(screen.getByText('No #реклама')).toBeInTheDocument();
    expect(screen.getByText(/text-excludes: matched/)).toBeInTheDocument();
  });

  it('renders flood_wait with seconds', () => {
    render(<ActivityRow event={event({ kind: 'flood_wait', seconds: 17 })} />);
    expect(screen.getByText(/FloodWait 17s/i)).toBeInTheDocument();
  });

  it('renders failed with error block', () => {
    render(<ActivityRow event={event({ kind: 'failed', error: 'PEER_ID_INVALID' })} />);
    expect(screen.getByText('PEER_ID_INVALID')).toBeInTheDocument();
  });

  it('falls back to "sub #N" when title missing', () => {
    render(<ActivityRow event={event({ subscriptionId: 7, subscriptionTitle: null })} />);
    expect(screen.getByText('sub #7')).toBeInTheDocument();
  });
});

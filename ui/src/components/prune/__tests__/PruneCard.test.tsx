import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '@/store/useStore';
import { PruneCard, parseKeep } from '../PruneCard';

const mutate = vi.fn();
let previewState: Record<string, unknown> = {};
const previewArgs: unknown[][] = [];

vi.mock('@/api/hooks/useAgents', () => ({
  usePruneAgent: () => ({ mutate, isPending: false }),
  usePrunePreview: (...args: unknown[]) => {
    previewArgs.push(args);
    return {
      refetch: vi.fn(),
      isLoading: false,
      isError: false,
      isFetching: false,
      ...previewState,
    };
  },
}));

const preview = {
  totalImages: 8,
  totalImageSize: 4 * 1024 ** 3,
  removableImages: 3,
  removableSize: 1024 ** 3,
  stoppedContainers: 2,
  stoppedSize: 2048,
  includeStopped: false,
  items: [{ image: 'app:1', size: 1024 ** 3, kind: 'image' }],
};

// jsdom has no PointerEvent, which base-ui's checkbox dispatches on click.
if (!window.PointerEvent) {
  window.PointerEvent =
    class PointerEvent extends MouseEvent {} as unknown as typeof window.PointerEvent;
}

beforeEach(() => {
  vi.clearAllMocks();
  previewArgs.length = 0;
  previewState = { data: preview };
  useStore.setState({ pruneProgress: {}, pruneCompletedAt: {}, toasts: [] });
});

const renderCard = (online = true) =>
  render(<PruneCard agentId="a1" agentName="web-1" online={online} />);

describe('parseKeep', () => {
  it.each([
    ['0', 0],
    ['1', 1],
    ['10', 10],
    ['11', null],
    ['', null],
    ['-1', null],
    ['1.5', null],
    ['abc', null],
  ])('%j -> %s', (raw, out) => expect(parseKeep(raw)).toBe(out));
});

describe('PruneCard', () => {
  it('shows used space and what can be pruned', () => {
    renderCard();
    expect(screen.getByText('4.0 GB')).toBeInTheDocument();
    expect(screen.getByText('8 total')).toBeInTheDocument();
    expect(screen.getByText('3 unused images')).toBeInTheDocument();
    expect(screen.getByText('kept (not selected)')).toBeInTheDocument();
  });

  it('leaves stopped containers alone until the checkbox is ticked', () => {
    renderCard();
    expect(previewArgs.at(-1)?.[1]).toEqual({ keepPrevious: 1, includeStopped: false });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Also remove stopped containers' }));
    expect(previewArgs.at(-1)?.[1]).toEqual({ keepPrevious: 1, includeStopped: true });
  });

  it('sends the chosen options when the prune is confirmed', () => {
    renderCard();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Also remove stopped containers' }));
    fireEvent.change(screen.getByLabelText('Keep previous versions'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: /prune images/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Prune' }));
    expect(mutate).toHaveBeenCalledWith(
      { id: 'a1', keepPrevious: 2, includeStopped: true },
      expect.any(Object),
    );
  });

  it('blocks pruning when keep-previous is not a valid number (no silent 0)', () => {
    renderCard();
    fireEvent.change(screen.getByLabelText('Keep previous versions'), { target: { value: '' } });
    expect(screen.getByText(/whole number from 0 to 10/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /prune images/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Dry Run' })).toBeDisabled();
  });

  it('disables pruning and explains when the agent is offline', () => {
    renderCard(false);
    expect(screen.getByText(/usage summary unavailable/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /prune images/i })).toBeDisabled();
  });

  it('shows progress while a prune is running', () => {
    useStore.setState({
      pruneProgress: {
        a1: { dryRun: false, phase: 'images', done: 2, total: 4, current: 'app:1' },
      },
    });
    renderCard();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
    expect(screen.getByText('Removing image 2/4 — app:1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /pruning/i })).toBeDisabled();
  });

  it('says nothing to prune when nothing qualifies', () => {
    previewState = { data: { ...preview, removableImages: 0, removableSize: 0 } };
    renderCard();
    expect(screen.getByText('Nothing to prune')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /prune images/i })).toBeDisabled();
  });

  it('shows why the summary failed', () => {
    previewState = { data: undefined, isError: true, error: new Error('agent did not respond') };
    renderCard();
    expect(screen.getByText(/Couldn't load usage summary/)).toBeInTheDocument();
  });

  it('lists what a dry run would remove', () => {
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Dry Run' }));
    expect(screen.getByText('app:1')).toBeInTheDocument();
    expect(screen.getByText(/Nothing is removed/)).toBeInTheDocument();
  });
});

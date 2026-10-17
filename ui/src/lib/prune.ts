import type { PruneAgentOutcome } from '@watchwarden/types';

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** i;
  return `${value >= 10 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/** "3 images, 1 container" — only the parts that are non-zero ("nothing" if both are). */
export function describeRemoved(images: number, containers: number): string {
  const parts: string[] = [];
  if (images > 0) parts.push(plural(images, 'image'));
  if (containers > 0) parts.push(plural(containers, 'container'));
  return parts.length > 0 ? parts.join(', ') : 'nothing';
}

export interface PruneToast {
  type: 'success' | 'error' | 'info';
  message: string;
}

/** Toast shown when one agent's prune (or dry run) finishes. */
export function pruneToast(
  o: Pick<
    PruneAgentOutcome,
    | 'agentName'
    | 'status'
    | 'imagesRemoved'
    | 'containersRemoved'
    | 'spaceReclaimed'
    | 'errors'
    | 'error'
  >,
  dryRun: boolean,
): PruneToast {
  const what = describeRemoved(o.imagesRemoved, o.containersRemoved);
  const size = formatBytes(o.spaceReclaimed);
  if (o.status === 'failed') {
    return {
      type: 'error',
      message: `Prune failed on ${o.agentName}: ${o.error ?? o.errors[0] ?? 'unknown error'}`,
    };
  }
  if (dryRun) {
    return {
      type: 'info',
      message:
        what === 'nothing'
          ? `Dry run on ${o.agentName}: nothing to prune`
          : `Dry run on ${o.agentName}: would remove ${what} (~${size})`,
    };
  }
  if (o.status === 'partial') {
    return {
      type: 'error',
      message: `Pruned ${o.agentName} with errors: removed ${what} (~${size}), ${o.errors.length} failed`,
    };
  }
  return {
    type: 'success',
    message:
      what === 'nothing'
        ? `Nothing to prune on ${o.agentName}`
        : `Pruned ${o.agentName}: removed ${what}, freed ~${size}`,
  };
}

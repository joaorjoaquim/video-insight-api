import { AsyncLocalStorage } from 'async_hooks';
import type { VideoPipelineContext } from './video-types';

const storage = new AsyncLocalStorage<VideoPipelineContext>();

export function runWithVideoContext<T>(
  ctx: VideoPipelineContext,
  fn: () => T
): T {
  return storage.run(ctx, fn);
}

export function getVideoContext(): VideoPipelineContext | undefined {
  return storage.getStore();
}

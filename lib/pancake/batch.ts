export type BatchOutcome<R> = {
  /** Finished items, in the order of the input. */
  succeeded: { index: number; value: R }[];
  /** Items whose work threw, in the order of the input. One failure never stops the others. */
  failed: { index: number; error: unknown }[];
};

/**
 * Runs `work` for every item with at most `limit` running at once. Used to fetch all shops without opening dozens of
 * Pancake sessions together. `onSettled` fires after each item finishes (successfully or not).
 */
export async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  work: (item: T, index: number) => Promise<R>,
  onSettled?: (settled: number, total: number) => void,
): Promise<BatchOutcome<R>> {
  const succeeded: BatchOutcome<R>["succeeded"] = [];
  const failed: BatchOutcome<R>["failed"] = [];
  let next = 0;
  let settled = 0;

  async function worker() {
    while (next < items.length) {
      const index = next++;
      try {
        succeeded.push({ index, value: await work(items[index], index) });
      } catch (error) {
        failed.push({ index, error });
      }
      settled += 1;
      onSettled?.(settled, items.length);
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, Math.min(Math.floor(limit), items.length)) }, worker));
  const byIndex = (a: { index: number }, b: { index: number }) => a.index - b.index;
  return { succeeded: succeeded.sort(byIndex), failed: failed.sort(byIndex) };
}

/**
 * Runs `step` for each item, one after another, each waiting for the last. For work whose order matters:
 * writes inside one transaction (unique sort orders, gap-free numbers), or calls that must not overlap.
 */
export async function inSequence<T>(items: Iterable<T>, step: (item: T, index: number) => Promise<unknown>): Promise<void> {
  let index = 0;
  for (const item of items) await step(item, index++); // NOSONAR: sequential on purpose (see above)
}

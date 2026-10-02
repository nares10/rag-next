/**
 * Reciprocal rank fusion. Combines independently ranked result lists using rank only,
 * never the underlying scores — cosine similarity and ts_rank_cd aren't on a comparable
 * scale, so any attempt to blend them numerically needs per-corpus calibration. RRF
 * needs none and reliably rewards items both legs agree on.
 */
export const RRF_K = 60;

export type Fused<T> = T & { fusedScore: number };

export function reciprocalRankFusion<T extends { id: string }>(
  lists: T[][],
  options: { k?: number } = {},
): Fused<T>[] {
  const k = options.k ?? RRF_K;
  const byId = new Map<string, Fused<T>>();

  for (const list of lists) {
    for (const [index, item] of list.entries()) {
      const contribution = 1 / (k + index + 1);
      const existing = byId.get(item.id);

      if (existing) {
        existing.fusedScore += contribution;
        continue;
      }

      byId.set(item.id, { ...item, fusedScore: contribution });
    }
  }

  return [...byId.values()].sort((a, b) => b.fusedScore - a.fusedScore);
}

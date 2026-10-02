import { describe, expect, it } from "bun:test";
import { reciprocalRankFusion } from "../../lib/rag/fuse";

const hit = (id: string) => ({ id, content: `content of ${id}` });

describe("reciprocalRankFusion", () => {
  it("returns an empty list when every input list is empty", () => {
    expect(reciprocalRankFusion([[], []])).toEqual([]);
  });

  it("passes a single list through in its original order", () => {
    const fused = reciprocalRankFusion([[hit("a"), hit("b"), hit("c")]]);

    expect(fused.map((f) => f.id)).toEqual(["a", "b", "c"]);
  });

  it("ranks an item that both legs agree on above one that only leads a single leg", () => {
    // Worked example with k=60:
    //   a = 1/61 + 1/63 = 0.032266
    //   b = 1/62 + 1/61 = 0.032522  <- wins without topping either list
    //   c = 1/63 + 1/62 = 0.032002
    const fused = reciprocalRankFusion([
      [hit("a"), hit("b"), hit("c")],
      [hit("b"), hit("c"), hit("a")],
    ]);

    expect(fused.map((f) => f.id)).toEqual(["b", "a", "c"]);
  });

  it("deduplicates items that appear in both lists, keeping one entry", () => {
    const fused = reciprocalRankFusion([
      [hit("a"), hit("b")],
      [hit("b"), hit("a")],
    ]);

    expect(fused).toHaveLength(2);
  });

  it("reports the fused score so callers can apply a cut-off", () => {
    const fused = reciprocalRankFusion([[hit("a")]]);

    expect(fused[0].fusedScore).toBeCloseTo(1 / 61, 6);
  });

  it("keeps the payload of the first list the item appeared in", () => {
    const fused = reciprocalRankFusion([[{ id: "a", content: "from vector" }], [{ id: "a", content: "from keyword" }]]);

    expect(fused[0].content).toBe("from vector");
  });

  it("contributes nothing for a list an item is absent from", () => {
    const [first] = reciprocalRankFusion([[hit("a")], [hit("b")]]);

    expect(first.fusedScore).toBeCloseTo(1 / 61, 6);
  });
});

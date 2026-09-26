import { describe, expect, it } from "vitest";

import { OUTFIT_IDS, OUTFITS } from "../pet/Wardrobe";
import { layerPlan } from "./VrmPet";

const layers = (id: keyof typeof OUTFITS) => [...layerPlan(OUTFITS[id]).keys()].sort();

describe("clothing layers per outfit", () => {
  it("dresses the canon look: suit, cropped jacket, shorts, thigh-highs", () => {
    expect(layers("edgerunner")).toEqual(
      ["Layer_Jacket", "Layer_Shoes", "Layer_Shorts", "Layer_Sleeves", "Layer_Suit", "Layer_ThighHigh"].sort(),
    );
    const plan = layerPlan(OUTFITS.edgerunner);
    expect(plan.get("Layer_Suit")?.glow).toBe(OUTFITS.edgerunner.top.accent);
    expect(plan.get("Layer_Jacket")?.color).toBe(OUTFITS.edgerunner.jacket?.from);
  });

  it("casual: turtleneck sleeves without a jacket, jeans, glasses and necklace", () => {
    expect(layers("casual")).toEqual(
      ["Layer_Glasses", "Layer_Jeans", "Layer_Necklace", "Layer_Shoes", "Layer_Sleeves", "Layer_Suit", "Layer_Tights"].sort(),
    );
    expect(layerPlan(OUTFITS.casual).has("Layer_Jacket")).toBe(false);
  });

  it("dresses use the skirt in the suit colour; sunglasses add lenses", () => {
    const plan = layerPlan(OUTFITS.cyberdress);
    expect(plan.get("Layer_Skirt")?.color).toBe(plan.get("Layer_Suit")?.color);
    expect(layers("pool")).toContain("Layer_Lenses");
    expect(layers("pool")).not.toContain("Layer_Shorts");
  });

  it("sheer legwear is see-through, boots come with boot styles", () => {
    const plan = layerPlan(OUTFITS.nightout);
    expect(plan.get("Layer_Tights")?.opacity).toBeLessThan(1);
    expect(plan.has("Layer_Boots")).toBe(true);
  });

  it("every outfit wears a suit and shoes", () => {
    for (const id of OUTFIT_IDS) {
      const plan = layerPlan(OUTFITS[id]);
      expect(plan.has("Layer_Suit"), id).toBe(true);
      expect(plan.has("Layer_Shoes"), id).toBe(true);
    }
  });
});

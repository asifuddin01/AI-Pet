import { describe, expect, it } from "vitest";

import { OUTFIT_IDS, OUTFITS } from "../pet/Wardrobe";
import { layerPlan } from "./VrmPet";

const layers = (id: keyof typeof OUTFITS) => [...layerPlan(OUTFITS[id]).keys()].sort();

describe("clothing layers per outfit", () => {
  it("dresses the canon look: leotard, off-shoulder jacket, thigh-highs", () => {
    expect(layers("edgerunner")).toEqual(
      ["Layer_JacketOff", "Layer_Leotard", "Layer_Shoes", "Layer_Sleeves", "Layer_ThighHigh"].sort(),
    );
    const plan = layerPlan(OUTFITS.edgerunner);
    expect(plan.get("Layer_Leotard")?.glow).toBe(OUTFITS.edgerunner.top.accent);
    expect(plan.get("Layer_JacketOff")?.color).toBe(OUTFITS.edgerunner.jacket?.from);
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
    expect(layers("pool")).toContain("Layer_Leotard");
    expect(layers("pool")).toContain("Layer_Lenses");
    expect(layers("pool")).not.toContain("Layer_Shorts");
  });

  it("sheer legwear is see-through, boots come with boot styles", () => {
    const plan = layerPlan(OUTFITS.nightout);
    expect(plan.get("Layer_Tights")?.opacity).toBeLessThan(1);
    expect(plan.has("Layer_Boots")).toBe(true);
  });

  it("crop tops and bikinis use their own layers", () => {
    expect(layers("street")).toContain("Layer_CropTop");
    expect(layers("street")).not.toContain("Layer_Suit");
    expect(layers("beach")).toEqual(expect.arrayContaining(["Layer_BikiniTop", "Layer_BikiniBottom", "Layer_Lenses"]));
    expect(layers("gym")).toEqual(expect.arrayContaining(["Layer_CropTop", "Layer_Leggings"]));
  });

  it("netrunner wears her headphones and neural cables", () => {
    expect(layers("netrunner")).toEqual(
      expect.arrayContaining(["Layer_Headphones", "Layer_HeadphonesGlow", "Layer_Cables", "Layer_Tights"]),
    );
    expect(layerPlan(OUTFITS.netrunner).get("Layer_HeadphonesGlow")?.glow).toBe(OUTFITS.netrunner.top.accent);
  });

  it("every outfit has a top and shoes", () => {
    const tops = ["Layer_Suit", "Layer_Leotard", "Layer_CropTop", "Layer_BikiniTop"];
    for (const id of OUTFIT_IDS) {
      const plan = layerPlan(OUTFITS[id]);
      expect(tops.some((t) => plan.has(t)), id).toBe(true);
      expect(plan.has("Layer_Shoes"), id).toBe(true);
    }
  });
});

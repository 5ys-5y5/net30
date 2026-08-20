import type { VitaminVariantConfig } from "../api/contracts";

export const DEFAULT_CONTENTS: readonly VitaminVariantConfig[] = [
  {
    id: "round-yellow",
    shape: "round-tablet",
    count: 150,
    colors: ["#f3d85b", "#f7e885", "#e9c43f"],
    radius: 0.0044,
    halfHeight: 0.0019,
    mass: 0.0011,
    friction: 0.68,
    restitution: 0.05,
  },
  {
    id: "caplet-gold",
    shape: "caplet",
    count: 80,
    colors: ["#e2ad43", "#f0c35c", "#c98b2e"],
    radius: 0.0030,
    halfHeight: 0.0045,
    mass: 0.0012,
    friction: 0.6,
    restitution: 0.06,
  },
] as const;

export const CONTENT_PRESETS: Readonly<Record<string, readonly VitaminVariantConfig[]>> = {
  multivitamin: DEFAULT_CONTENTS,
  "vitamin-c": [
    {
      id: "orange-tablet",
      shape: "round-tablet",
      count: 230,
      colors: ["#f29a3d", "#ffb354", "#db7827"],
      radius: 0.00435,
      halfHeight: 0.0019,
      mass: 0.0011,
      friction: 0.66,
      restitution: 0.05,
    },
  ],
  omega3: [
    {
      id: "amber-softgel",
      shape: "softgel",
      count: 145,
      colors: ["#d98625", "#f0a33b", "#b96818"],
      radius: 0.0037,
      halfHeight: 0.0052,
      mass: 0.0014,
      friction: 0.38,
      restitution: 0.08,
    },
  ],
  capsule: [
    {
      id: "blue-white-capsule",
      shape: "capsule",
      count: 160,
      colors: ["#2d65d9", "#f2f5fb"],
      radius: 0.0030,
      halfHeight: 0.0046,
      mass: 0.001,
      friction: 0.5,
      restitution: 0.07,
    },
  ],
};

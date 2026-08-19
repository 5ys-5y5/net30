import { calculateReceiptPrice, type CostBreakdownInput, DEFAULT_PRICING_POLICY, type PricingPolicy } from "./pricing-model";

import type { ProductCostLine } from "../../docs/design-system/entry";

export const forms = [
  {
    id: "all-in-one",
    code: "01",
    name: "30일분",
    detail: "1,500mg × 30정 · 총 45g",
    surcharge: 0,
    visual: {
      kind: "threeD" as const,
      src: "/vitamin_bottle_3d_editor.html",
      alt: "NET30 멀티비타민 미네랄 올인원",
    },
  },
] as const;

export type Form = (typeof forms)[number];

const batchSpecs = [
  { id: "pilot", code: "V01", name: "일반가", role: "영업이익 30%", oemCost: 3113, score: 26 },
  { id: "growth", code: "V02", name: "회원가", role: "영업이익 30%", oemCost: 2199, score: 27 },
  { id: "scale", code: "V03", name: "정기구독가", role: "영업이익 30%", oemCost: 1286, score: 30 },
] as const;
type BatchSpec = (typeof batchSpecs)[number];
type CostBatch = Batch | BatchSpec;

export type Batch = {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly role: string;
  readonly oemCost: number;
  readonly price: number;
  readonly score: number;
};

export type RawIngredient = { id: string; name: string; amount: string; cost: number };

export const rawIngredients: readonly RawIngredient[] = [
  { id: "calcium", name: "탄산칼슘", amount: "칼슘 210mg", cost: 650 },
  { id: "magnesium", name: "산화마그네슘", amount: "마그네슘 94.5mg", cost: 420 },
  { id: "c", name: "비타민C", amount: "비타민C 100mg", cost: 360 },
  { id: "e", name: "비타민E혼합제제", amount: "비타민E 11mg α-TE", cost: 280 },
  { id: "iron", name: "푸마르산제일철", amount: "철 6mg", cost: 180 },
  { id: "zinc", name: "산화아연", amount: "아연 8.5mg", cost: 170 },
  { id: "manganese", name: "황산망간", amount: "망간 3mg", cost: 110 },
  { id: "b12", name: "비타민B12혼합제제", amount: "비타민B12 24μg", cost: 240 },
  { id: "d", name: "비타민D3혼합제제", amount: "비타민D 10μg", cost: 220 },
  { id: "a", name: "비타민A혼합제제", amount: "비타민A 700μg RAE", cost: 210 },
  { id: "b1", name: "비타민B1염산염", amount: "비타민B1 3.6mg", cost: 80 },
  { id: "b2", name: "비타민B2", amount: "비타민B2 4.2mg", cost: 90 },
  { id: "b6", name: "비타민B6염산염", amount: "비타민B6 4.5mg", cost: 100 },
  { id: "pantothenic", name: "판토텐산칼슘", amount: "판토텐산 5mg", cost: 90 },
  { id: "biotin", name: "비오틴혼합제제", amount: "비오틴 90μg", cost: 190 },
  { id: "folate", name: "엽산", amount: "엽산 400μg DFE", cost: 70 },
  { id: "copper", name: "황산동", amount: "구리 0.4mg", cost: 60 },
  { id: "iodine", name: "요오드칼륨", amount: "요오드 75μg", cost: 40 },
  { id: "selenium", name: "건조효모(셀렌)", amount: "셀렌 55μg", cost: 150 },
  { id: "molybdenum", name: "몰리브덴산나트륨", amount: "몰리브덴 12.5μg", cost: 40 },
  { id: "chromium", name: "염화크롬", amount: "크롬 15μg", cost: 110 },
  { id: "k", name: "비타민K1혼합제제", amount: "비타민K 70μg", cost: 160 },
  { id: "carotene", name: "베타카로틴혼합제제", amount: "베타카로틴 1.26mg", cost: 120 },
  { id: "cellulose", name: "결정셀룰로스", amount: "정제 부형제", cost: 360 },
  { id: "maltodextrin", name: "말토덱스트린", amount: "혼합제제 담체", cost: 190 },
  { id: "cmc", name: "카복시메틸셀룰로스칼슘", amount: "붕해제", cost: 170 },
  { id: "hpmc", name: "히드록시프로필메틸셀룰로스", amount: "코팅기제", cost: 220 },
  { id: "stearate", name: "스테아린산마그네슘", amount: "제조용 기타원료", cost: 100 },
  { id: "silica", name: "이산화규소", amount: "제조용 기타원료", cost: 80 },
  { id: "glyceride", name: "글리세린지방산에스테르", amount: "코팅용 기타원료", cost: 70 },
  { id: "shellac", name: "쉘락", amount: "코팅용 기타원료", cost: 80 },
  { id: "glycerin", name: "글리세린", amount: "코팅용 기타원료", cost: 60 },
  { id: "starch", name: "옥수수전분", amount: "혼합제제 담체", cost: 120 },
] as const;

type CostLineValue = number | ((batch: CostBatch) => number);
export type CostLineTemplate = {
  readonly id: string;
  readonly label: string;
  readonly amount: CostLineValue;
};

export type CostGroupTemplate = {
  readonly id: ProductCostLine["group"];
  readonly label: string;
  readonly lines: readonly CostLineTemplate[];
};

export const costGroups = [
  { id: "ingredient", label: "원료" },
  { id: "production", label: "생산" },
  { id: "distribution", label: "유통" },
  { id: "growth", label: "마케팅" },
  { id: "operation", label: "운영" },
  { id: "profit", label: "이익" },
  { id: "tax", label: "세금" },
] as const;

export const costTemplateGroups: readonly CostGroupTemplate[] = [
  {
    id: "production",
    label: "생산",
    lines: [
      { id: "inbound", label: "원료 입고·관세·검수", amount: 650 },
      { id: "qa", label: "품질시험·인증", amount: 520 },
      { id: "package", label: "PVC·알루미늄 PTP·단상자·스티커", amount: 900 },
      { id: "oem", label: "GMP 제조공임", amount: (batch) => batch.oemCost },
    ],
  },
  {
    id: "distribution",
    label: "유통",
    lines: [
      { id: "fulfillment", label: "보관·피킹·배송", amount: 488 },
      { id: "channel", label: "결제·판매채널 수수료", amount: 0 },
    ],
  },
  {
    id: "growth",
    label: "마케팅",
    lines: [{ id: "promotion", label: "광고·콘텐츠·판매촉진", amount: 0 }],
  },
  {
    id: "operation",
    label: "운영",
    lines: [{ id: "operation", label: "고객지원·인건비·운영", amount: 2053 }],
  },
] as const;

export const ingredientTotalCost = rawIngredients.reduce((sum, ingredient) => sum + ingredient.cost, 0);

const resolveCostValue = (batch: CostBatch, value: CostLineValue): number => (typeof value === "function" ? value(batch) : value);

export const buildCostItems = (batch: CostBatch): CostBreakdownInput => {
  const sum = (groupId: Exclude<ProductCostLine["group"], "ingredient" | "profit" | "tax">) =>
    costTemplateGroups
      .filter((group) => group.id === groupId)
      .flatMap((group) => group.lines)
      .reduce((acc, item) => acc + resolveCostValue(batch, item.amount), 0);

  return {
    ingredientCost: ingredientTotalCost,
    productionCost: sum("production"),
    distributionCost: sum("distribution"),
    marketingCost: sum("growth"),
    operationCost: sum("operation"),
  };
};

export const buildCostLines = (batch: CostBatch): readonly ProductCostLine[] =>
  costTemplateGroups.flatMap((group) =>
    group.lines.map((entry) => line(entry.id, entry.label, group.id, resolveCostValue(batch, entry.amount))),
  );

export const buildBatches = (policy: Partial<PricingPolicy> = DEFAULT_PRICING_POLICY): readonly Batch[] =>
  batchSpecs.map((batch) => {
    const cost = buildCostItems(batch);
    const receipt = calculateReceiptPrice(cost, policy);
    return {
      ...batch,
      price: receipt.consumerPrice,
    };
  });

export const costColumns: readonly [string, string, string, string, string] = ["항목명", "세부내용", "게이지", "가격", "비율"];

export const line = (id: string, label: string, group: ProductCostLine["group"], amount: number): ProductCostLine => ({ id, label, group, amount });

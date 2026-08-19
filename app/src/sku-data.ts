import type { KoreanSupplementLabelDefinition, ProductCostLine, ProductPageDefinition } from "../../docs/design-system/entry";
import { landingCopy } from "./landing-copy";
import { calculateReceiptPrice, type CostBreakdownInput, DEFAULT_PRICING_POLICY, type PricingPolicy } from "./pricing-model";

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

const makeIngredients = (ingredients: readonly RawIngredient[]) =>
  ingredients.map((ingredient) => ({
    id: ingredient.id,
    name: ingredient.name,
    amount: ingredient.amount,
    cost: ingredient.cost,
  }));

const makeLabel = (form: Form, batch: Batch): KoreanSupplementLabelDefinition => {
  const ingredients = makeIngredients(rawIngredients);
  const costItems = buildCostItems(batch);
  const receipt = calculateReceiptPrice(costItems, DEFAULT_PRICING_POLICY);

  const costs: readonly ProductCostLine[] = [
    ...buildCostLines(batch),
    line("profit", "영업이익", "profit", receipt.operatingProfit),
    line("vat", "부가가치세", "tax", receipt.vat),
  ];

  return {
    id: `${form.id}-${batch.id}-label`,
    badge: "",
    title: "한글표시사항",
    identification: [
      { label: "제품명", value: "멀티비타민미네랄 올인원" },
      { label: "식품유형", value: "비타민·무기질" },
      { label: "내용량", value: "총 45g(1,500mg × 30정)" },
      { label: "제조번호", value: `K2608-${batch.code}` },
      { label: "소비기한", value: "제품 측면 별도 표시일까지" },
      { label: "보관방법", value: "고온다습 및 직사광선을 피해 건조한 곳에 보관" },
    ],
    sections: [
      {
        id: "function",
        title: "영양·기능정보",
        fields: [
          { label: "1일 섭취량", value: "1일 1회, 1회 1정(1,500mg)" },
          { label: "열량", value: "4kcal" },
          { label: "탄수화물·단백질·지방·나트륨", value: "1g 미만(0%) · 0g(0%) · 0g(0%) · 0mg(0%)" },
          { label: "비타민B1", value: "3.6mg(300%)" },
          { label: "비타민B2", value: "4.2mg(300%)" },
          { label: "비타민B6", value: "4.5mg(300%)" },
          { label: "비타민B12", value: "24μg(1,000%)" },
          { label: "판토텐산", value: "5mg(100%)" },
          { label: "비오틴", value: "90μg(300%)" },
          { label: "엽산", value: "400μg DFE(100%)" },
          { label: "비타민C", value: "100mg(100%)" },
          { label: "셀렌", value: "55μg(100%)" },
          { label: "칼슘", value: "210mg(30%)" },
          { label: "비타민A", value: "700μg RAE(100%)" },
          { label: "비타민D", value: "10μg(100%)" },
          { label: "비타민E", value: "11mg α-TE(100%)" },
          { label: "비타민K", value: "70μg(100%)" },
          { label: "철", value: "6mg(50%)" },
          { label: "망간", value: "3mg(100%)" },
          { label: "아연", value: "8.5mg(100%)" },
          { label: "몰리브덴", value: "12.5μg(50%)" },
          { label: "크롬", value: "15μg(50%)" },
          { label: "마그네슘", value: "94.5mg(30%)" },
          { label: "구리", value: "0.4mg(50%)" },
          { label: "요오드", value: "75μg(50%)" },
          { label: "베타카로틴", value: "1.26mg" },
        ],
        copy: [
          "비타민과 무기질은 탄수화물·단백질·지방·에너지 대사, 세포와 혈액 생성, 항산화, 면역기능, 뼈와 치아 형성 및 정상적인 신체 기능 유지에 필요합니다.",
          "( ) 안의 수치는 1일 영양성분 기준치에 대한 비율입니다.",
        ],
      },
      {
        id: "directions",
        title: "섭취방법 및 주의사항",
        copy: [
          "충분한 물과 함께 섭취하십시오. 고칼슘혈증이 있거나 의약품을 복용하는 경우 전문가와 상담하십시오. 이상 사례가 발생하면 섭취를 중단하고 전문가와 상담하십시오.",
          "본 제품은 질병의 예방 및 치료를 위한 의약품이 아닙니다.",
          "개봉 후 공기 노출을 최소화하고 영·유아 및 어린이의 손이 닿지 않는 곳에 보관하십시오.",
          "같은 제조시설에서 알류, 메밀, 땅콩, 대두, 밀, 고등어, 게, 새우, 돼지고기, 복숭아, 토마토, 아황산류, 호두, 닭고기, 쇠고기, 오징어, 조개류를 사용한 제품을 제조하고 있습니다.",
        ],
      },
      {
        id: "business",
        title: "제조·판매 및 포장 정보",
        fields: [
          { label: "건강기능식품전문제조원", value: "㈜노바렉스 · 충청북도 청주시 흥덕구 오송읍 오송생명14로 80" },
          { label: "건강기능식품유통전문판매원", value: "종근당건강㈜ · 충남 당진시 합덕읍 인더스파크로 170" },
          { label: "포장재질", value: "내포장 PVC·알루미늄박" },
          { label: "알레르기", value: "우유 함유" },
          { label: "소비자상담실", value: "080-977-3308" },
          { label: "이상사례 신고", value: "1577-2488" },
        ],
      },
    ],
    ingredientsTitle: "원료명 및 함량",
    ingredients,
    costsTitle: "전체 가격 구조",
    consumerPrice: batch.price,
    costColumns,
    costGroups,
    costs,
    notices: [],
  };
};

const batches = buildBatches(DEFAULT_PRICING_POLICY);
const skus = forms.flatMap((item) => batches.map((batch) => ({ id: `${item.id}-${batch.id}`, label: makeLabel(item, batch) })));
const combinations = forms.flatMap((formItem) =>
  batches.map((batch, batchIndex) => ({
    id: `${formItem.id}-${batch.id}`,
    primaryId: formItem.id,
    secondaryId: batch.id,
    routeId: batchIndex === 0 ? "pilot-oem" : batchIndex === 1 ? "growth-oem" : "scale-oem",
    skuId: `${formItem.id}-${batch.id}`,
  })),
);

export const net30Definition: ProductPageDefinition = {
  ...landingCopy,
  catalog: {
    presentation: "label",
    primaryOptions: forms,
    secondaryOptions: batches.map((batch) => ({
      id: batch.id,
      code: batch.code,
      name: batch.name,
      role: batch.role,
      price: batch.price,
      landedCost: 0,
      score: batch.score,
      values: {},
    })),
    combinations,
    skus,
    routes: [
      { id: "source", city: "글로벌 원료사", country: "원산지 계약 전", role: "비타민·무기질 원료", location: [35, 100] },
      { id: "pilot-oem", city: "오송", country: "대한민국", role: "3천 개 생산", location: [36.6, 127.3] },
      { id: "growth-oem", city: "오송", country: "대한민국", role: "1만 개 생산", location: [36.6, 127.3] },
      { id: "scale-oem", city: "오송", country: "대한민국", role: "3만 개 생산", location: [36.6, 127.3] },
    ],
    arcs: [
      { id: "source-pilot", from: 0, to: 1, cost: "첫 생산" },
      { id: "pilot-growth", from: 1, to: 2, cost: "MOQ 절감" },
      { id: "growth-scale", from: 2, to: 3, cost: "대량 생산" },
    ],
    metrics: [],
    economics: {
      vatRate: DEFAULT_PRICING_POLICY.vatRate,
      percentageScale: 100,
      platformRate: 0,
    },
    detailPanels: ["route"],
  },
};

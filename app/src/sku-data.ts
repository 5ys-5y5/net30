import type { KoreanSupplementLabelDefinition, ProductCostLine, ProductPageDefinition } from "../../docs/design-system/entry";
import { landingCopy } from "./landing-copy";
import { calculateReceiptPrice, type CostBreakdownInput, DEFAULT_PRICING_POLICY, type PricingPolicy } from "./pricing-model";

const NET30_3D_SERVICE_ORIGIN =
  import.meta.env.VITE_NET30_3D_SERVICE_URL ?? "http://127.0.0.1:5174";
const NET30_HOST_ORIGIN =
  typeof window === "undefined" ? "http://127.0.0.1:5173" : window.location.origin;
const NET30_3D_SERVICE_SRC =
  `${NET30_3D_SERVICE_ORIGIN}/?hostOrigin=${encodeURIComponent(NET30_HOST_ORIGIN)}&contents=multivitamin`;
export const directViralSalesPolicy = {
  channel: "바이럴 직판",
  platformSalesFee: 0,
  paidMediaCost: 0,
  salesPromotionCost: 0,
} as const;

export const forms = [
  {
    id: "all-in-one",
    code: "01",
    name: "30일분",
    detail: "1,500mg × 30정 · 총 45g",
    surcharge: 0,
    visual: {
      kind: "threeD" as const,
      src: NET30_3D_SERVICE_SRC,
      alt: "NET30 멀티비타민 미네랄 올인원",
    },
  },
] as const;

export type Form = (typeof forms)[number];

/**
 * 제공된 220원 GMP 제조공임을 3만 개 생산 기준으로 두고,
 * 기존 3천 개·1만 개·3만 개 배치의 상대적인 단가 차이만 유지했습니다.
 */
const batchSpecs = [
  { id: "pilot", code: "V01", name: "일반가", role: "바이럴 직판 · 최종 판매가 대비 이익 30%", gmpCost: 533 },
  { id: "growth", code: "V02", name: "회원가", role: "바이럴 직판 · 최종 판매가 대비 이익 30%", gmpCost: 376 },
  { id: "scale", code: "V03", name: "정기구독가", role: "바이럴 직판 · 최종 판매가 대비 이익 30%", gmpCost: 220 },
] as const;
type BatchSpec = (typeof batchSpecs)[number];
type CostBatch = Batch | BatchSpec;

export type Batch = {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly role: string;
  readonly gmpCost: number;
  readonly price: number;
  readonly score: number;
};

export type RawIngredient = { id: string; name: string; amount: string; cost: number };

/**
 * 참고표의 33개 상세 금액 합계는 223원이지만 대분류 합계는 220원입니다.
 * 원단위 반올림 차이를 없애기 위해 가장 큰 세 항목을 각각 1원씩 정규화해
 * 상세 합계와 전체 가격 구조의 원료 합계를 220원으로 일치시켰습니다.
 */
export const rawIngredients: readonly RawIngredient[] = [
  { id: "calcium", name: "탄산칼슘", amount: "칼슘 210mg", cost: 17 },
  { id: "magnesium", name: "산화마그네슘", amount: "마그네슘 94.5mg", cost: 14 },
  { id: "c", name: "비타민C", amount: "비타민C 100mg", cost: 47 },
  { id: "e", name: "비타민E 혼합제제", amount: "비타민E 11mg α-TE", cost: 18 },
  { id: "iron", name: "푸마르산제일철", amount: "철 6mg", cost: 4 },
  { id: "zinc", name: "산화아연", amount: "아연 8.5mg", cost: 2 },
  { id: "manganese", name: "황산망간", amount: "망간 3mg", cost: 1 },
  { id: "b12", name: "비타민B12 혼합제제", amount: "비타민B12 24μg", cost: 11 },
  { id: "d", name: "비타민D3 혼합제제", amount: "비타민D 10μg", cost: 8 },
  { id: "a", name: "비타민A 혼합제제", amount: "비타민A 700μg RAE", cost: 7 },
  { id: "b1", name: "비타민B1", amount: "비타민B1 3.6mg", cost: 2 },
  { id: "b2", name: "비타민B2", amount: "비타민B2 4.2mg", cost: 2 },
  { id: "b6", name: "비타민B6 염산염", amount: "비타민B6 4.5mg", cost: 2 },
  { id: "pantothenic", name: "판토텐산칼슘", amount: "판토텐산 5mg", cost: 2 },
  { id: "biotin", name: "비오틴 혼합제제", amount: "비오틴 90μg", cost: 4 },
  { id: "folate", name: "엽산", amount: "엽산 400μg DFE", cost: 2 },
  { id: "copper", name: "황산동", amount: "구리 0.4mg", cost: 1 },
  { id: "iodine", name: "요오드칼륨", amount: "요오드 75μg", cost: 1 },
  { id: "selenium", name: "건조효모(셀렌)", amount: "셀렌 55μg", cost: 7 },
  { id: "molybdenum", name: "몰리브덴산나트륨", amount: "몰리브덴 12.5μg", cost: 1 },
  { id: "chromium", name: "염화크롬", amount: "크롬 15μg", cost: 1 },
  { id: "k", name: "비타민K1 혼합제제", amount: "비타민K 70μg", cost: 3 },
  { id: "carotene", name: "베타카로틴 혼합제제", amount: "베타카로틴 1.26mg", cost: 8 },
  { id: "cellulose", name: "결정셀룰로스", amount: "정제 부형제", cost: 13 },
  { id: "maltodextrin", name: "말토덱스트린", amount: "혼합제제 담체", cost: 8 },
  { id: "cmc", name: "카복시메틸셀룰로스칼슘", amount: "붕해제", cost: 6 },
  { id: "hpmc", name: "히드록시프로필메틸셀룰로스", amount: "코팅기제", cost: 9 },
  { id: "stearate", name: "스테아린산마그네슘", amount: "제조용 기타원료", cost: 4 },
  { id: "silica", name: "이산화규소", amount: "제조용 기타원료", cost: 3 },
  { id: "glyceride", name: "글리세린지방산에스테르", amount: "코팅용 기타원료", cost: 2 },
  { id: "shellac", name: "쉘락", amount: "코팅용 기타원료", cost: 3 },
  { id: "glycerin", name: "글리세린", amount: "코팅용 기타원료", cost: 2 },
  { id: "starch", name: "옥수수전분 혼합제제", amount: "담체", cost: 5 },
] as const;

type CostLineValue = number | ((batch: CostBatch) => number);
export type CostLineTemplate = {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
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
      {
        id: "inbound",
        label: "원료 입고·관세·검수",
        detail: "원료 입고·수입부대비·검수·칭량 준비",
        amount: 55,
      },
      {
        id: "qa",
        label: "품질시험·인증",
        detail: "원료·완제품 시험, 미생물·중금속·함량 QC",
        amount: 45,
      },
      {
        id: "package",
        label: "PVC·알루미늄 PTP·단상자·스티커",
        detail: "PTP·알루미늄·단상자·인쇄·표시·포장",
        amount: 230,
      },
      {
        id: "gmp",
        label: "GMP 제조공임",
        detail: "혼합·타정·코팅·검사·포장 생산공정",
        amount: (batch) => batch.gmpCost,
      },
      {
        id: "manufacturing-overhead",
        label: "제조간접비",
        detail: "공장관리·감가상각·전력·폐기·생산관리",
        amount: 80,
      },
      {
        id: "oem-margin",
        label: "OEM 제조사 마진",
        detail: "제조사 이윤 및 판관비 배부",
        amount: 300,
      },
    ],
  },
  {
    id: "distribution",
    label: "유통",
    lines: [
      { id: "storage", label: "보관", detail: "직판 재고 보관비 배부", amount: 30 },
      { id: "picking", label: "피킹·입고·출고", detail: "입고·피킹·출고 작업", amount: 125 },
      { id: "shipping-package", label: "배송 포장", detail: "배송용 포장재 및 포장작업", amount: 50 },
      { id: "delivery", label: "배송", detail: "택배 배송원가 배부", amount: 650 },
      { id: "payment", label: "결제수수료", detail: "카드·PG 등 직접 결제비용", amount: 80 },
      {
        id: "platform-channel",
        label: "플랫폼·판매채널 수수료",
        detail: "플랫폼 미입점·바이럴 직판 전용",
        amount: directViralSalesPolicy.platformSalesFee,
      },
      {
        id: "returns-loss",
        label: "반품·폐기·재고손실",
        detail: "반품·파손·폐기·재고 리스크",
        amount: 50,
      },
    ],
  },
  {
    id: "growth",
    label: "마케팅",
    lines: [
      {
        id: "paid-media",
        label: "유료 광고·홍보 채널",
        detail: "광고·검색·브랜드 노출 미사용",
        amount: directViralSalesPolicy.paidMediaCost,
      },
      {
        id: "promotion",
        label: "쿠폰·판매촉진",
        detail: "할인·쿠폰·판촉·장려금 미사용",
        amount: directViralSalesPolicy.salesPromotionCost,
      },
    ],
  },
  {
    id: "operation",
    label: "운영",
    lines: [
      { id: "product-rnd", label: "상품기획·R&D", detail: "상품개발·기획·연구 배부비", amount: 50 },
      {
        id: "brand-design",
        label: "브랜드·디자인·상품정보",
        detail: "브랜드·패키지 디자인과 상품정보 유지",
        amount: 40,
      },
      { id: "regulatory", label: "품질·법규관리", detail: "표시사항·품질관리·법규 대응", amount: 25 },
      { id: "inventory", label: "재고관리", detail: "재고자산·재고손실 관리", amount: 40 },
      { id: "cs", label: "CS·교환·반품", detail: "고객상담·교환·반품 처리", amount: 30 },
      { id: "head-office", label: "본사관리비 배부", detail: "인사·재무·IT·경영관리 배부", amount: 100 },
    ],
  },
] as const;

export const ingredientTotalCost = rawIngredients.reduce((sum, ingredient) => sum + ingredient.cost, 0);

if (ingredientTotalCost !== 220) {
  throw new Error(`원료 33개 세부 항목 합계는 220원이어야 합니다: ${ingredientTotalCost}원`);
}

const resolveCostValue = (batch: CostBatch, value: CostLineValue): number =>
  typeof value === "function" ? value(batch) : value;

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

export const line = (
  id: string,
  label: string,
  group: ProductCostLine["group"],
  amount: number,
  detail = "",
): ProductCostLine => ({ id, label, detail, group, amount });

export const buildCostLines = (batch: CostBatch): readonly ProductCostLine[] =>
  costTemplateGroups.flatMap((group) =>
    group.lines.map((entry) =>
      line(entry.id, entry.label, group.id, resolveCostValue(batch, entry.amount), entry.detail),
    ),
  );

export const buildBatches = (policy: Partial<PricingPolicy> = DEFAULT_PRICING_POLICY): readonly Batch[] =>
  batchSpecs.map((batch) => {
    const cost = buildCostItems(batch);
    const receipt = calculateReceiptPrice(cost, policy);
    return {
      ...batch,
      price: receipt.consumerPrice,
      score: Math.round((ingredientTotalCost / receipt.consumerPrice) * 100),
    };
  });

export const costColumns: readonly [string, string, string, string, string] = [
  "항목명",
  "세부내용",
  "게이지",
  "가격",
  "비율",
];

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
    line(
      "profit",
      "이익",
      "profit",
      receipt.profit,
      "VAT 포함 최종 판매가의 30%를 목표로 배분한 이익",
    ),
    line(
      "vat",
      "부가가치세",
      "tax",
      receipt.vat,
      "최종 판매가에 포함된 매출 부가가치세(10/110)",
    ),
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
const skus = forms.flatMap((item) =>
  batches.map((batch) => ({
    id: `${item.id}-${batch.id}`,
    label: makeLabel(item, batch),
  })),
);
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
      vatRate: 1 + DEFAULT_PRICING_POLICY.vatTaxRate,
      percentageScale: 100,
      platformRate: 0,
    },
    detailPanels: ["route"],
  },
};

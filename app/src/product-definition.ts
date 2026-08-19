import type { KoreanSupplementLabelDefinition, ProductCostLine, ProductPageDefinition } from "../../docs/design-system/entry";

/**
 * ============================================
 *  Product definition data model (maps to / route UI)
 * ============================================
 *
 * [수정 지점 가이드]
 * - hero 영역: net30Definition.hero
 * - 상단 탭/설명: net30Definition.labels / net30Definition.navigation / net30Definition.brand
 * - 옵션 버튼: forms / catalogSecondaryOptions / batches
 * - 한글표시사항 카드: makeLabel() / form/batch 조합
 * - 가격 구조표(비용): makeLabel() 내부 ingredient/costs/costGroups
 * - 공급망 지도: catalog.routes / catalog.arcs
 */

const TARGET_PROFIT_RATE = 0.3;
const VAT_RATE = 1.1;
const FIXED_NON_PROFIT_COST = 10201;

// ============================================
// 1) Form / SKU configuration (페이지: 가격·제품 선택 영역)
// ============================================

const forms = [
  {
    id: "all-in-one",
    code: "01",
    name: "30일분",
    detail: "1,500mg × 30정 · 총 45g",
    surcharge: 0,
    visual: {
      kind: "image" as const,
      src: "/vitamin-all-in-one.svg",
      alt: "NET30 멀티비타민 미네랄 올인원",
    },
  },
] as const;

export type Form = (typeof forms)[number];

// 30% 영업이익이 맞춰지는 판매가 역산
const priceForThirtyPercentProfit = (oemCost: number) => {
  for (let price = FIXED_NON_PROFIT_COST + oemCost; price < 100000; price += 1) {
    const profit = Math.round(price * TARGET_PROFIT_RATE);
    const vat = Math.round(price - price / VAT_RATE);
    if (FIXED_NON_PROFIT_COST + oemCost + profit + vat === price) {
      return Math.floor(price / 10) * 10;
    }
  }
  throw new Error("30% 영업이익 판매가를 계산할 수 없습니다.");
};

const batchSpecs = [
  { id: "pilot", code: "V01", name: "일반가", role: "영업이익 30%", oemCost: 3113, score: 26 },
  { id: "growth", code: "V02", name: "회원가", role: "영업이익 30%", oemCost: 2199, score: 27 },
  { id: "scale", code: "V03", name: "정기구독가", role: "영업이익 30%", oemCost: 1286, score: 30 },
] as const;

export type Batch = {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly role: string;
  readonly oemCost: number;
  readonly price: number;
  readonly score: number;
};

const batches: readonly Batch[] = batchSpecs.map((batch) => ({
  ...batch,
  price: priceForThirtyPercentProfit(batch.oemCost),
}));

// ============================================
// 2) 비용 그룹/원료 데이터 (페이지: 한글표시사항/가격구조)
// ============================================

type RawIngredient = { id: string; name: string; amount: string; cost: number };

const rawIngredients: readonly RawIngredient[] = [
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

const ingredientCostTemplate = {
  inboundCost: 650,
  productionCost: 520,
  packagingCost: 900,
  fulfillmentCost: 488,
  oemOverheadCost: 0,
  operationCost: 2053,
};

const line = (id: string, label: string, group: ProductCostLine["group"], amount: number): ProductCostLine => ({ id, label, group, amount });

const costGroups = [
  { id: "ingredient", label: "원료" },
  { id: "production", label: "생산" },
  { id: "distribution", label: "유통" },
  { id: "growth", label: "마케팅" },
  { id: "operation", label: "운영" },
  { id: "profit", label: "이익" },
  { id: "tax", label: "세금" },
] as const;

const costColumns: readonly [string, string, string, string, string] = ["항목명", "세부내용", "게이지", "가격", "비율"];

const makeLabel = (form: Form, batch: Batch): KoreanSupplementLabelDefinition => {
  // [UI 매핑] 한글표시사항 카드 전체
  const ingredients = rawIngredients.map((ingredient) => ({
    id: ingredient.id,
    name: ingredient.name,
    amount: ingredient.amount,
    cost: ingredient.cost,
  }));

  // [UI 매핑] 가격구조표 계산값
  const vat = Math.round(batch.price - batch.price / VAT_RATE);
  const operatingProfit = batch.price - FIXED_NON_PROFIT_COST - batch.oemCost - vat;

  // [UI 매핑] Sticker 하단 ‘가격 구조’ 행
  const costs: readonly ProductCostLine[] = [
    line("inbound", "원료 입고·관세·검수", "production", ingredientCostTemplate.inboundCost),
    line("oem", "GMP 제조공임", "production", batch.oemCost),
    line("qa", "품질시험·인증", "production", ingredientCostTemplate.productionCost),
    line("package", "PVC·알루미늄 PTP·단상자·스티커", "production", ingredientCostTemplate.packagingCost),
    line("fulfillment", "보관·피킹·배송", "distribution", ingredientCostTemplate.fulfillmentCost),
    line("channel", "결제·판매채널 수수료", "distribution", ingredientCostTemplate.oemOverheadCost),
    line("promotion", "광고·콘텐츠·판매촉진", "growth", 0),
    line("operation", "고객지원·인건비·운영", "operation", ingredientCostTemplate.operationCost),
    line("profit", "영업이익", "profit", operatingProfit),
    line("vat", "부가가치세", "tax", vat),
  ];

  return {
    id: `${form.id}-${batch.id}-label`,
    badge: "",
    title: "한글표시사항",

    // [UI 매핑] 스티커 상단 제품 항목 (법정정보)
    identification: [
      { label: "제품명", value: "멀티비타민미네랄 올인원" },
      { label: "식품유형", value: "비타민·무기질" },
      { label: "내용량", value: "총 45g(1,500mg × 30정)" },
      { label: "제조번호", value: `K2608-${batch.code}` },
      { label: "소비기한", value: "제품 측면 별도 표시일까지" },
      { label: "보관방법", value: "고온다습 및 직사광선을 피해 건조한 곳에 보관" },
    ],

    // [UI 매핑] 접기 가능한 섹션
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

    // [UI 매핑] 접기 가능한 원료 상세 행
    ingredientsTitle: "원료명 및 함량",
    ingredients,
    // [UI 매핑] 가격구조 표
    costsTitle: "전체 가격 구조",
    consumerPrice: batch.price,
    costColumns,
    costGroups,
    costs,
    notices: [],
  };
};

// ============================================
// 3) SKU 조합 생성기 (페이지: 옵션 조합 → 선택 SKU 매핑)
// ============================================

const skus = forms.flatMap((form) => batches.map((batch) => ({ id: `${form.id}-${batch.id}`, label: makeLabel(form, batch) })));

const combinations = forms.flatMap((form, formIndex) =>
  batches.map((batch, batchIndex) => ({
    id: `${form.id}-${batch.id}`,
    primaryId: form.id,
    secondaryId: batch.id,
    routeId: batchIndex === 0 ? "pilot-oem" : batchIndex === 1 ? "growth-oem" : "scale-oem",
    skuId: `${form.id}-${batch.id}`,
  })),
);

// ============================================
// 4) 최종 페이지 정의 (영역: header/hero/catalog/principles/footer)
// ============================================

export const net30Definition: ProductPageDefinition = {
  regions: ["header", "hero", "catalog", "principles", "footer"],

  meta: {
    title: "NET30 — 멀티비타민 원가 표시사항",
    description: "멀티비타민 영양·기능성분과 소비자가격 전부를 공개합니다.",
  },

  system: {
    locale: "ko-KR",
    language: "ko",
    favicon: "/favicon.svg",
    topId: "top",
    catalogId: "receipt",
    traceId: "trace",
    principlesId: "principles",
  },

  brand: {
    name: "NET30",
    tagline: "소비자가 낸 금액을 빠짐없이 설명합니다.",
    location: "서울 · K2608 비타민 배치",
  },

  // [페이지: 상단 내비게이션]
  navigation: [
    { label: "한글표시사항", target: "catalog" },
    { label: "원료 경로", target: "trace" },
    { label: "공개 원칙", target: "principles" },
  ],

  labels: {
    // [페이지: 상단 공통 라벨]
    primaryNavigation: "주요 메뉴",
    bag: "배치",
    currency: "원",
    currencyMark: "₩",
    percent: "%",
    dot: " · ",
    down: "↓",

    // [페이지: catalog 영역 옵션 라벨]
    primaryChoice: "제품 선택",
    secondaryChoice: "생산 배치 선택",

    // [페이지: trace 패널]
    economics: "가격 구성",
    supplyRoute: "원료와 제조 경로",
    routeNode: "공급지",
    score: "원료비 비중",
    scoreSuffix: "%",
    scoreNote: "",
    routeAria: "원료와 제조 공급 경로",
    routeHint: "드래그해서 경로 확인",
    distance: "미분류 차액 0원",
    economicsNote: "",

    // [페이지: 경제 모델 수치]
    vat: "부가가치세",
    platform: "결제·판매채널 수수료",
    landed: "공개 비용",
    contribution: "목표 배부후이익",
    contributionSuffix: "시장 중간값 시안",
  },

  // [페이지: hero 섹션]
  hero: {
    label: {
      lines: [{ text: "멀티비타민·미네랄 올인원" }],
    },
    heading: {
      lines: [
        { text: "더 투명한 가격" },
        { text: "더 합리적 소비" , emphasis: true },
      ],
    },
    copy: {
      lines: [{ text: "원료, 제조, 검사, 포장, 물류, 운영비, 영업이익을 모두 공개해요." }],
    },
    link: {
      lines: [{ text: "멀티비타민 표시사항 보기", }],
    },
    index: "가격 선택",
    range: "일반가 · 회원가 · 정기구독가",
    left: "가격 구조 전액 공개",
    right: "영업이익 30%",
  },

  // [페이지: catalog heading]
  catalogSection: {
    label: "제품에 실제로 붙는 정보",
    title: [],
    copy: [],
  },

  // [페이지: 원칙 섹션]
  principlesSection: {
    label: "출고 전에 지키는 원칙",
    title: ["비용은 숨기거나 옮겨 담지 않고", "발생한 이름 그대로 적습니다."],
    copy: [
      "마케팅비와 판매채널 수수료는 0원으로 유지합니다.",
      "실제 비용을 먼저 합산한 뒤 영업이익 30%가 되도록 가격을 역산합니다.",
    ],
  },

  // [페이지: principles 항목]
  principles: [
    {
      code: "01 / 가격",
      title: "실제 비용에서 역산",
      copy: "원료부터 부가가치세까지 실제 비용을 계산한 뒤 영업이익률 30%가 되는 가격을 구합니다.",
    },
    {
      code: "02 / 영업이익",
      title: "항상 30%",
      copy: "비용이 바뀌면 판매가와 영업이익 금액이 함께 다시 계산됩니다.",
    },
    {
      code: "03 / 법정정보",
      title: "한글표시사항 우선",
      copy: "제품명, 내용량, 기능정보, 섭취방법, 주의사항, 제조·판매 정보를 법정 표시 구조로 제공합니다.",
    },
    {
      code: "04 / 원가",
      title: "원료와 비용을 같은 줄에",
      copy: "기능성원료와 기타원료의 쓰임, 제품당 비용을 한 표에서 확인합니다.",
    },
  ],

  catalog: {
    presentation: "label",

    // [UI 매핑] 제품군 버튼들(현재 기본 1개 폼 유지)
    primaryOptions: forms,

    // [UI 매핑] 가격군 버튼들(V01/V02/V03)
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

    // [UI 매핑] 하단 공급망 지도 영역
    routes: [
      { id: "source", city: "글로벌 원료사", country: "원산지 계약 전", role: "비타민·무기질 원료", location: [35, 100] },
      { id: "pilot-oem", city: "오송", country: "대한민국", role: "3천 개 생산", location: [36.6, 127.3] },
      { id: "growth-oem", city: "오송", country: "대한민국", role: "1만 개 생산", location: [36.6, 127.3] },
      { id: "scale-oem", city: "오송", country: "대한민국", role: "3만 개 생산", location: [36.6, 127.3] },
    ],

    // [UI 매핑] 지도 경로 라벨
    arcs: [
      { id: "source-pilot", from: 0, to: 1, cost: "첫 생산" },
      { id: "pilot-growth", from: 1, to: 2, cost: "MOQ 절감" },
      { id: "growth-scale", from: 2, to: 3, cost: "대량 생산" },
    ],

    // [UI 매핑] 현재 사용 안 함
    metrics: [],

    economics: {
      vatRate: VAT_RATE,
      percentageScale: 100,
      platformRate: 0,
    },
    detailPanels: ["route"],
  },
};

import type { KoreanSupplementLabelDefinition, ProductCostLine, ProductPageDefinition } from "../../docs/design-system/entry";
import { landingCopy } from "./landing-copy";
import { calculateReceiptPrice, DEFAULT_PRICING_POLICY } from "./pricing-model";
import {
  type Batch,
  costColumns,
  costGroups,
  type Form,
  buildCostItems,
  buildCostLines,
  line,
  rawIngredients,
  type RawIngredient,
  buildBatches,
  forms,
} from "./sku-data";

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
      vatRate: DEFAULT_PRICING_POLICY.vatRate,
      percentageScale: 100,
      platformRate: 0,
    },
    detailPanels: ["route"],
  },
};

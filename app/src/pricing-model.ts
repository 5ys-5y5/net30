export type PricingPolicy = {
  readonly consumerPriceProfitRate: number;
  readonly vatTaxRate: number;
};

export const DEFAULT_PRICING_POLICY: PricingPolicy = {
  consumerPriceProfitRate: 0.3,
  vatTaxRate: 0.1,
};

export type CostBreakdownInput = {
  ingredientCost: number;
  productionCost: number;
  distributionCost: number;
  marketingCost: number;
  operationCost: number;
};

export type ReceiptPriceResult = {
  nonProfitCost: number;
  consumerPriceProfitRate: number;
  vatTaxRate: number;
  vatMultiplier: number;
  vatExcludedRevenue: number;
  consumerPrice: number;
  profit: number;
  vat: number;
};

const finiteOrZero = (value: number): number => (Number.isFinite(value) ? value : 0);

const assertFraction = (name: string, value: number) => {
  if (value < 0 || value >= 1) {
    throw new Error(`${name}은 0 이상 1 미만이어야 합니다.`);
  }
};

export const calculateReceiptPrice = (
  cost: CostBreakdownInput,
  policy: Partial<PricingPolicy> = {},
): ReceiptPriceResult => {
  const consumerPriceProfitRate = finiteOrZero(
    policy.consumerPriceProfitRate ?? DEFAULT_PRICING_POLICY.consumerPriceProfitRate,
  );
  const vatTaxRate = finiteOrZero(policy.vatTaxRate ?? DEFAULT_PRICING_POLICY.vatTaxRate);

  assertFraction("최종 판매가 대비 이익률", consumerPriceProfitRate);
  assertFraction("부가가치세율", vatTaxRate);

  const vatMultiplier = 1 + vatTaxRate;
  const vatShareOfConsumerPrice = vatTaxRate / vatMultiplier;
  const costShareOfConsumerPrice = 1 - consumerPriceProfitRate - vatShareOfConsumerPrice;

  if (costShareOfConsumerPrice <= 0) {
    throw new Error("최종 판매가에서 이익과 부가가치세를 제외한 원가 비중은 0보다 커야 합니다.");
  }

  const nonProfitCost = Math.max(
    0,
    Math.round(
      (cost.ingredientCost ?? 0) +
      (cost.productionCost ?? 0) +
      (cost.distributionCost ?? 0) +
      (cost.marketingCost ?? 0) +
      (cost.operationCost ?? 0),
    ),
  );

  const consumerPrice = nonProfitCost === 0
    ? 0
    : Math.round(nonProfitCost / costShareOfConsumerPrice);
  const vat = Math.max(0, Math.round(consumerPrice * vatShareOfConsumerPrice));
  const profit = Math.max(0, consumerPrice - nonProfitCost - vat);
  const vatExcludedRevenue = consumerPrice - vat;
  const targetProfit = Math.round(consumerPrice * consumerPriceProfitRate);

  if (Math.abs(profit - targetProfit) > 1) {
    throw new Error("원 단위 반올림 후 이익이 최종 판매가 대비 목표 이익률과 일치하지 않습니다.");
  }

  if (nonProfitCost + profit + vat !== consumerPrice) {
    throw new Error("최종 판매가는 원가, 이익, 부가가치세 합계와 일치해야 합니다.");
  }

  return {
    nonProfitCost,
    consumerPriceProfitRate,
    vatTaxRate,
    vatMultiplier,
    vatExcludedRevenue,
    consumerPrice,
    profit,
    vat,
  };
};

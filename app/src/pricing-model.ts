export const DEFAULT_PRICING_POLICY = {
  operatingProfitRate: 0.3,
  vatRate: 1.1,
} as const;

export type PricingPolicy = typeof DEFAULT_PRICING_POLICY;

export type CostBreakdownInput = {
  ingredientCost: number;
  productionCost: number;
  distributionCost: number;
  marketingCost: number;
  operationCost: number;
};

export type ReceiptPriceResult = {
  nonProfitCost: number;
  operatingProfitRate: number;
  vatRate: number;
  consumerPrice: number;
  operatingProfit: number;
  vat: number;
};

const clamp = (value: number): number => (Number.isFinite(value) ? value : 0);

const assertRate = (name: string, value: number) => {
  if (value <= 0 || value >= 1) {
    throw new Error(`${name}은 0과 1 사이여야 합니다.`);
  }
};

export const calculateReceiptPrice = (
  cost: CostBreakdownInput,
  policy: Partial<PricingPolicy> = {},
): ReceiptPriceResult => {
  const operatingProfitRate = clamp(policy.operatingProfitRate ?? DEFAULT_PRICING_POLICY.operatingProfitRate);
  const vatRate = clamp(policy.vatRate ?? DEFAULT_PRICING_POLICY.vatRate);

  assertRate("영업이익률", operatingProfitRate);
  if (vatRate < 1) {
    throw new Error("VAT율은 1 이상이어야 합니다.");
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

  const consumerPrice = Math.round(nonProfitCost / (1 - operatingProfitRate) * vatRate);
  const vat = Math.max(0, Math.round(consumerPrice - consumerPrice / vatRate));
  const operatingProfit = Math.max(0, consumerPrice - nonProfitCost - vat);

  return {
    nonProfitCost,
    operatingProfitRate,
    vatRate,
    consumerPrice,
    operatingProfit,
    vat,
  };
};

export type ProductVisual =
  | { kind: "silhouette"; variant: "crew" | "relaxed" | "pocket" }
  | { kind: "image"; src: string; alt: string }
  | {
      kind: "threeD";
      src: string;
      alt: string;
    };

export type RenderedLabelTexture = {
  dataUrl: string;
  pixelWidth: number;
  pixelHeight: number;
  sourceLabels: readonly [string, string];
};

export type ThreeDLabelPayload = {
  skuId: string;
  renderedLabel: RenderedLabelTexture;
};

export type PrimaryOption = {
  id: string;
  code: string;
  name: string;
  detail: string;
  surcharge: number;
  visual: ProductVisual;
};

export type SecondaryOption = {
  id: string;
  code: string;
  name: string;
  role: string;
  price: number;
  landedCost: number;
  score: number;
  values: Readonly<Record<string, string>>;
};

export type LabelField = { label: string; value: string };
export type LabelSection = { id: string; title: string; fields?: readonly LabelField[]; copy?: readonly string[] };
export type IngredientCostLine = { id: string; name: string; amount: string; cost: number };
export type ProductCostLine = {
  id: string;
  label: string;
  detail?: string;
  group: "ingredient" | "production" | "distribution" | "growth" | "operation" | "tax" | "profit";
  amount: number;
};
export type PriceCostGroup = { id: ProductCostLine["group"]; label: string };

export type HeroTextSegment = {
  text: string;
  emphasis?: boolean;
};

export type HeroTextDefinition = {
  lines: readonly HeroTextSegment[];
};

export type KoreanSupplementLabelDefinition = {
  id: string;
  badge: string;
  title: string;
  identification: readonly LabelField[];
  sections: readonly LabelSection[];
  ingredientsTitle: string;
  ingredients: readonly IngredientCostLine[];
  costsTitle: string;
  consumerPrice: number;
  costColumns: readonly [string, string, string, string, string];
  costGroups: readonly PriceCostGroup[];
  costs: readonly ProductCostLine[];
  notices: readonly string[];
};

export type ProductSku = { id: string; label: KoreanSupplementLabelDefinition };
export type ProductCombination = { id: string; primaryId: string; secondaryId: string; routeId: string; skuId: string };
export type SupplyRoute = { id: string; city: string; country: string; role: string; location: [number, number] };
export type SupplyArc = { id: string; from: number; to: number; cost: string };
export type MetricDefinition = { key: string; label: string; suffix?: string };

export type CatalogDefinition = {
  presentation?: "metrics" | "label";
  primaryOptions: readonly PrimaryOption[];
  secondaryOptions: readonly SecondaryOption[];
  combinations: readonly ProductCombination[];
  routes: readonly SupplyRoute[];
  arcs: readonly SupplyArc[];
  metrics: readonly MetricDefinition[];
  economics: { vatRate: number; percentageScale: number; platformRate: number };
  skus: readonly ProductSku[];
  detailPanels: readonly ("route" | "economics")[];
};

export type TemplateRegion = "header" | "hero" | "catalog" | "principles" | "footer";

export type ProductPageDefinition = {
  regions: readonly TemplateRegion[];
  meta: { title: string; description: string };
  system: { locale: string; language: string; favicon: string; topId: string; catalogId: string; traceId: string; principlesId: string };
  brand: { name: string; tagline: string; location: string };
  navigation: readonly { label: string; target: "catalog" | "trace" | "principles" }[];
  labels: {
    primaryNavigation: string; bag: string; currency: string; currencyMark: string; percent: string; dot: string; down: string;
    primaryChoice: string; secondaryChoice: string; economics: string; supplyRoute: string; routeNode: string;
    score: string; scoreSuffix: string; scoreNote: string; routeAria: string; routeHint: string; distance: string;
    economicsNote: string; vat: string; platform: string; landed: string; contribution: string; contributionSuffix: string;
  };
  hero: {
    label: HeroTextDefinition;
    heading: HeroTextDefinition;
    copy: HeroTextDefinition;
    link: HeroTextDefinition;
    index: string;
    range: string;
    left: string;
    right: string;
  };
  catalogSection: { label: string; title: readonly string[]; copy: readonly string[] };
  principlesSection: { label: string; title: readonly string[]; copy: readonly string[] };
  principles: readonly { code: string; title: string; copy: string }[];
  catalog: CatalogDefinition;
};

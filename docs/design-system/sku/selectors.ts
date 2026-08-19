import type { CatalogDefinition } from "../schema";

export function selectCombination(catalog: CatalogDefinition, primaryIndex: number, secondaryIndex: number) {
  const primary = catalog.primaryOptions[primaryIndex];
  const secondary = catalog.secondaryOptions[secondaryIndex];
  const combination = catalog.combinations.find((item) => item.primaryId === primary.id && item.secondaryId === secondary.id);
  if (!combination) throw new Error(`Missing product combination for ${primary.id} × ${secondary.id}`);
  const factoryIndex = catalog.routes.findIndex((route) => route.id === combination.routeId);
  const factory = catalog.routes[factoryIndex];
  if (!factory) throw new Error(`Missing supply route ${combination.routeId}`);
  const sku = catalog.skus.find((item) => item.id === combination.skuId);
  if (!sku) throw new Error(`Missing SKU ${combination.skuId}`);
  return { primary, secondary, combination, factory, factoryIndex, sku };
}

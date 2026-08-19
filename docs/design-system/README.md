# Portable product-agnostic design system

Give this folder to a designer LLM and ask it to implement a product through `ProductPageDefinition`. The folder contains no required product meaning.

- `entry.ts`: public renderer and schema types
- `schema.ts`: content and product-data contract
- `template-map.mjs`: machine-readable region and atom registry
- `visual-contract.mjs`: ≥99% content-independent fidelity contract
- `index.tsx`: atomic UI implementation
- `Storefront.tsx`: data-driven template renderer
- `SupplyGlobe.tsx`: reusable route visualization
- `KoreanSupplementLabel`: SKU-linked Korean product-label and full price-reconciliation artifact
- `tokens.ts`, `system.css`, `typography.css`, `styles.css`: global visual and typography authorities
- `sku/`: generic combination selector and types
- `validation/`: executable rejection rules and mutation proofs

The host provides a data-only definition and imports `Storefront` plus `styles.css`. Run `npm run validate` and `npm run proof` in this directory before use.

# Content-independent design template

This directory defines how a product page looks and behaves; it does not define what the product is. Health supplements, computers, apparel, or another product category use the same system by supplying a typed product definition.

## Fixed visual grammar

- White primary surfaces, black structural emphasis, centralized muted states.
- One hairline authority and three structural radius levels plus the pill radius.
- Shared containers, panels, choices, grids, metrics, labels, media frames, globe, header, and footer.
- Shared spacing, alignment, typography, responsive behavior, clipping, and interaction geometry.
- Variant classes may express selected state but may not redefine atomic layout.

## Variable semantic composition

`template-map.mjs` lists the allowed region registry. The injected `regions` array selects and orders regions. The current renderer supports header, hero, catalog, principles, and footer; the catalog definition independently selects route and economics detail panels. No product file may emit JSX or CSS.

When `catalog.presentation` is `label`, every product combination resolves a `skuId`. The selected SKU supplies one `KoreanSupplementLabelDefinition`; `KoreanSupplementLabel` composes the centralized `Sticker*` atoms into two reusable sheets: statutory product information and the complete price structure. Statutory detail sections and cost categories with multiple child lines use markerless disclosure rows that are closed on initial render and toggle from the row itself. Cost categories represented completely by one parent row remain non-interactive. Parent and child gauges share a cumulative 100% price axis, so each category begins where the preceding category ends. The only visible total is the reconciled price in the price-sheet header; residual, list-price, and discount concepts are not rendered. Product files provide label data but never sticker JSX or styling.

`schema.ts` is the only accepted data shape. Text, navigation, metadata, product options, images, metrics, economics, supply routes, SKU label records, and principles are replaceable without changing the visual implementation.

## Fidelity definition

`visual-contract.mjs` defines the ≥99% content-independent target. The score excludes text meaning, text length consequences, and the pixels inside supplied product images. It includes token values, borders, radii, padding, margins, gaps, grid tracks, alignment, typography rules, breakpoints, panel contracts, selection geometry, globe rendering configuration, and drag behavior.

Copy this folder unchanged to preserve the visual system. Create a new external `ProductPageDefinition` for the new product context. Changing a token or atomic rule inside this folder intentionally changes every consuming service after its normal rebuild and deployment.

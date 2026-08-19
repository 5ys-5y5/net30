# Product-agnostic designer agent contract

This directory is a complete visual template, not a product page. A designer LLM must read this file, `DESIGN_ORDER.md`, `schema.ts`, `template-map.mjs`, `visual-contract.mjs`, `tokens.ts`, `system.css`, and `styles.css` before implementation.

## Mandatory method

1. Create product meaning outside this directory as one `ProductPageDefinition`. Product data may contain copy, options, metrics, routes, prices, images, and the ordered semantic `regions` array.
2. Never place product names, category terminology, prices, SKU records, marketing copy, or product-specific composition inside this directory.
3. Never put visual values in product data. Color, line, radius, spacing, size, typography, grids, alignment, and responsive behavior are owned only by `tokens.ts`, `system.css`, and `styles.css`.
4. Render only through `Storefront` from `entry.ts`. `Storefront` resolves the injected region array through the registry in `template-map.mjs`; product data cannot create JSX, CSS, classes, or DOM.
5. Use `ProductVisual` for product imagery. Select a supported centralized renderer or provide image data through the schema; never add page-local media geometry.
6. Use `KoreanSupplementLabel` for SKU-linked Korean product stickers. Ingredient and cost rows must come from the selected SKU, and their sum must equal the consumer price before rendering.
7. When intentionally changing the visual system, update its centralized authority and validation proof together. Every current service consumer will inherit that change on rebuild.
8. Run `npm run validate` and `npm run proof` from this directory. A failure must prevent development, build, start, and deployment.

The visual fidelity contract excludes copy and product-specific asset pixels. It protects geometry, tokens, typography, boundaries, composition primitives, responsive breakpoints, and interaction structure at a threshold of at least 99%.

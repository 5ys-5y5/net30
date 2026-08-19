# NET30 storefront

This Vite app consumes the product-agnostic design system in `../docs/design-system`.

All NET30-specific product copy, ingredients, batch options, routes, Korean label data, price-breakdown data, and the final `net30Definition` live in `src/sku-data.ts`. `src/pricing-model.ts` contains pricing rules only.

The storefront loads the production 3D viewer from `/assets/3d/vitamin-bottle/output/index.html`. The separate model editor is available at `/assets/3d/vitamin-bottle/editor/index.html`.

```bash
npm install
npm run dev
npm run build
```

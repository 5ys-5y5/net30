export const VISUAL_CONTRACT = Object.freeze({
  fidelityThreshold: 0.99,
  contentExcludedFromScore: true,
  tokenAuthority: "app/design-system/system.css",
  typographyAuthority: "app/design-system/typography.css",
  compositionAuthority: "app/design-system/styles.css",
  requiredTokens: Object.freeze([
    "--ds-white", "--ds-ink", "--ds-muted", "--ds-quiet", "--ds-soft", "--ds-subtle",
    "--ds-line-width", "--ds-selection-line-width", "--ds-line", "--ds-r-sm", "--ds-r-md", "--ds-r-lg", "--ds-pill",
    "--ds-font-sans", "--ds-font-serif", "--ds-font-mono", "--ds-page-gutter",
  ]),
  protectedGeometry: Object.freeze([
    "border", "border-radius", "padding", "margin", "gap", "display", "grid-template-columns",
    "grid-template-rows", "align-items", "justify-content", "font", "font-size", "line-height", "letter-spacing",
  ]),
  responsiveViewports: Object.freeze([1280, 900, 600]),
  protectedProductArtifacts: Object.freeze(["KoreanSupplementLabel"]),
});

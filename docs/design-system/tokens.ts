export const GLOBE = {
  devicePixelRatioMax: 2,
  resolutionScale: 2,
  initialPhi: 1.85,
  theta: 0.2,
  rotationSpeed: 0.003,
  dragSensitivity: 280,
  velocityDecay: 0.94,
  minimumVelocity: 0.0001,
  dark: 0,
  diffuse: 1.2,
  mapSamples: 16000,
  mapBrightness: 6,
  mapBaseBrightness: 0,
  baseColor: [1, 1, 1] as [number, number, number],
  glowColor: [1, 1, 1] as [number, number, number],
  markerColor: [0.05, 0.05, 0.05] as [number, number, number],
  markerSize: 0.035,
  activeMarkerSize: 0.06,
  markerElevation: 0.01,
  arcColor: [0.05, 0.05, 0.05] as [number, number, number],
  arcWidth: 0.32,
  arcHeight: 0.22,
  scale: 1,
  offset: [0, 0] as [number, number],
  opacity: 1,
} as const;

export const CLASS = {
  brand: "brand", choice: "ds-choice", choiceCode: "ds-choice-code", choiceContent: "ds-choice-content", choiceVisual: "ds-choice-visual", container: "ds-container", costBreakdown: "cost-breakdown", costFooter: "cost-footer", costItem: "cost-item", costItems: "cost-items", costTitle: "cost-title",
  density: "density", densityLine: "density-line", designCard: "design-card", designShowcase: "design-showcase",
  globe: "ds-globe", globeCard: "globe-card", globeCost: "ds-globe-cost", globeInteraction: "ds-globe-interaction", globeNode: "ds-globe-node", grid: "ds-grid", gridCell: "ds-grid-cell",
  hero: "hero", heroCopy: "hero-copy", heroFoot: "hero-foot", heroIndex: "hero-index", heroLink: "hero-link", heroProduct: "hero-product", heroTrio: "hero-trio",
  label: "ds-label", metric: "ds-metric", metrics: "metrics", nav: "nav", navBag: "nav-bag", panel: "ds-panel", panelBody: "ds-panel-body", panelFooter: "ds-panel-footer", panelHeader: "ds-panel-header",
  labelSticker: "ds-label-sticker", labelStickerSheet: "ds-label-sticker-sheet", labelStickerBadge: "ds-label-sticker-badge", labelStickerCopy: "ds-label-sticker-copy", labelStickerCostAmount: "ds-label-sticker-cost-amount", labelStickerCostMeta: "ds-label-sticker-cost-meta", labelStickerCostName: "ds-label-sticker-cost-name", labelStickerCostRow: "ds-label-sticker-cost-row", labelStickerCostRows: "ds-label-sticker-cost-rows", labelStickerCostDetail: "ds-label-sticker-cost-detail", labelStickerCostSummary: "ds-label-sticker-cost-summary", labelStickerCostHeader: "ds-label-sticker-cost-header", labelStickerCostGauge: "ds-label-sticker-cost-gauge", labelStickerEvidence: "ds-label-sticker-evidence", labelStickerField: "ds-label-sticker-field", labelStickerHead: "ds-label-sticker-head", labelStickerRow: "ds-label-sticker-row", labelStickerRows: "ds-label-sticker-rows", labelStickerSection: "ds-label-sticker-section", labelStickerSectionTitle: "ds-label-sticker-section-title", labelStickerTitle: "ds-label-sticker-title", labelStickerValue: "ds-label-sticker-value",
  footer: "footer", principles: "principles", principleGrid: "principle-grid", productGrid: "product-grid", productImage: "ds-product-image",
  modelingWorkspace: "ds-modeling-workspace", modelingWorkspaceMeta: "ds-modeling-workspace-meta", modelingWorkspaceName: "ds-modeling-workspace-name", modelingStudio: "ds-modeling-studio", modelingForm: "ds-modeling-form", modelingFields: "ds-modeling-fields", modelingField: "ds-modeling-field", modelingFieldWide: "ds-modeling-field-wide", modelingControl: "ds-modeling-control", modelingTextarea: "ds-modeling-textarea", modelingButton: "ds-modeling-button", modelingPreview: "ds-modeling-preview", modelingToolbar: "ds-modeling-toolbar", modelingFrame: "ds-modeling-frame", modelingResult: "ds-modeling-result", modelingError: "ds-modeling-error", modelingHint: "ds-modeling-hint", modelingChoices: "ds-modeling-choices", modelingChoice: "ds-modeling-choice", modelingComponentPrompt: "ds-modeling-component-prompt", modelingGroup: "ds-modeling-group", modelingGroupHead: "ds-modeling-group-head", modelingProgress: "ds-modeling-progress", modelingProgressList: "ds-modeling-progress-list", modelingProgressItem: "ds-modeling-progress-item", modelingLibrary: "ds-modeling-library", modelingLibraryGrid: "ds-modeling-library-grid", modelingVersionList: "ds-modeling-version-list", modelingVersion: "ds-modeling-version", modelingActions: "ds-modeling-actions", modelingAction: "ds-modeling-action", modelingOutputSections: "ds-modeling-output-sections", modelingOutputSection: "ds-modeling-output-section",
  qualityPrice: "quality-price", qualityPrices: "quality-prices",
  section: "section", sectionHead: "ds-section-head", surface: "ds-surface", tee: "ds-tee", teeCompact: "is-compact", teePocket: "ds-tee-pocket", teeRelaxed: "ds-tee-relaxed",
  trace: "trace", traceGrid: "trace-grid",
} as const;

export const joinClasses = (...values: Array<string | false | undefined>) => values.filter(Boolean).join(" ");

export const ELEMENT = { main: "main", nav: "nav", section: "section", footer: "footer", heading1: "h1", break: "br", emphasis: "em", span: "span", strong: "strong", small: "small", heading3: "h3", progress: "i", progressFill: "b", image: "img" } as const;
export const ROLE = { tablist: "tablist" } as const;
export const GLOBE_OVERLAY_KIND = { node: "node", cost: "cost" } as const;

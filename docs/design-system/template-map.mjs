export const TEMPLATE_REGISTRY = Object.freeze([
  Object.freeze({ region: "header", composition: "HeaderRegion", atoms: Object.freeze(["SiteHeader", "Container", "Link"]) }),
  Object.freeze({ region: "hero", composition: "HeroRegion", atoms: Object.freeze(["Container", "Label", "ProductVisual", "Link", "Surface"]) }),
  Object.freeze({ region: "catalog", composition: "CatalogRegion", atoms: Object.freeze(["Container", "SectionHeading", "LabeledChoice", "ProductVisual", "Metric", "KoreanSupplementLabel", "Sticker", "StickerSheet", "StickerHeader", "StickerSection", "StickerRows", "StickerField", "StickerCopy", "StickerCostRows", "StickerCostHeader", "StickerCostRow", "StickerCostGroup", "Panel", "SurfaceGrid", "GridCell", "ActionButton", "FormField", "FieldGroup", "SelectionCard", "SelectionCardControl", "ModelPreviewFrame", "AssociationList", "AssociationRow", "AssetIdentity", "AssetHierarchy", "AssetHierarchyItem", "AssetNodeActions", "AssetEditContext", "InlineAssetEditor", "DestructiveActionGate", "AssetEmptyState", "ReviewWorkspace", "ReviewWorkspaceHeader", "WorkflowStepper", "WorkflowStep", "ProposalCard", "ParameterEditor", "ParameterGroup", "ParameterQuestionCard", "ParameterValue", "EvidencePreview", "ReviewStatus", "ReviewProgress", "DecisionActions", "BuildGate", "BuildProgressPanel", "ModelResultPanel", "DecisionHistoryDisclosure", "ReviewScopeNavigator", "ReviewScopeControl", "ScopedApprovalBar", "ProcessProgressPanel", "ProgressStageList", "ProgressStage", "SketchReviewPanel", "SketchCanvas", "SketchAnnotationLayer", "PenToolbar", "IterationNavigator"]) }),
  Object.freeze({ region: "principles", composition: "PrinciplesRegion", atoms: Object.freeze(["Container", "SectionHeading", "Surface", "Label", "Copy"]) }),
  Object.freeze({ region: "footer", composition: "FooterRegion", atoms: Object.freeze(["SiteFooter", "Container", "Copy"]) }),
]);

export const REQUIRED_CONSUMER_IMPORTS = Object.freeze({
  page: Object.freeze(["./design-system/entry", "./product-definition"]),
  layout: Object.freeze(["./design-system/styles.css", "./product-definition"]),
});

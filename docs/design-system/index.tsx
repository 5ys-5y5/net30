import { Component, Fragment, forwardRef, useEffect, useRef } from "react";
import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  CanvasHTMLAttributes,
  ComponentPropsWithoutRef,
  CSSProperties,
  ElementType,
  FieldsetHTMLAttributes,
  HTMLAttributes,
  IframeHTMLAttributes,
  ReactNode,
  ErrorInfo,
  Ref,
  SVGAttributes,
} from "react";
import { CLASS, ELEMENT, joinClasses } from "./tokens";
import type {
  KoreanSupplementLabelDefinition,
  ProductVisual as ProductVisualDefinition,
  ThreeDLabelPayload,
} from "./schema";

function sendLabelPayloadToFrame(
  target: HTMLIFrameElement | null,
  payload: ThreeDLabelPayload | undefined,
  src: string,
) {
  if (!target?.contentWindow || !payload) return;
  const frameUrl = new URL(src, window.location.href);
  target.contentWindow.postMessage({ type: "NET30_LABEL_DATA", payload }, frameUrl.origin);
}

function ThreeDModel({
  visual,
  compact,
  labelPayload,
  modelAssetPath,
  runtimeState,
}: {
  visual: Extract<ProductVisualDefinition, { kind: "threeD" }>;
  compact: boolean;
  labelPayload?: ThreeDLabelPayload;
  modelAssetPath?: string | null;
  runtimeState?: "loading" | "unassigned" | "empty" | "ready";
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const frameSrc = modelAssetPath ? (() => { const url = new URL(visual.src, window.location.href); url.searchParams.set("model", modelAssetPath); if (labelPayload?.skuId) url.searchParams.set("sku", labelPayload.skuId); return url.toString(); })() : "";

  useEffect(() => {
    sendLabelPayloadToFrame(frameRef.current, labelPayload, frameSrc);
  }, [frameSrc, labelPayload]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const send = () => sendLabelPayloadToFrame(frame, labelPayload, frameSrc);
    frame.addEventListener("load", send);
    return () => frame.removeEventListener("load", send);
  }, [frameSrc, labelPayload]);

  if (!frameSrc) return <Surface className={CLASS.productImage} data-compact={compact} data-model-state={runtimeState ?? "loading"}><Copy>{runtimeState === "empty" ? "모델 구성 전" : runtimeState === "unassigned" ? "연결된 3D 모델 없음" : "3D 모델 연결 확인 중"}</Copy></Surface>;

  return <iframe
    ref={frameRef}
    className={CLASS.productImage}
    data-compact={compact}
    title={visual.alt}
    src={frameSrc}
    loading="lazy"
  />;
}

export function Atom<T extends ElementType = "div">({
  as,
  ...props
}: { as?: T } & Omit<ComponentPropsWithoutRef<T>, "as">) {
  const Tag = as ?? "div";
  return <Tag {...props} />;
}

export function Container<T extends ElementType = "div">({
  as,
  className = "",
  ...props
}: { as?: T; className?: string } & Omit<ComponentPropsWithoutRef<T>, "as" | "className">) {
  const Tag = as ?? "div";
  return <Tag className={joinClasses(CLASS.container, className)} {...props} />;
}

function Lines({ value }: { value: readonly string[] }) {
  return <>{value.map((line, index) => <Fragment key={line}>{index > 0 && <br />}{line}</Fragment>)}</>;
}

export function Surface({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={joinClasses(CLASS.surface, className)} {...props} />;
}

export function Panel({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={joinClasses(CLASS.surface, CLASS.panel, className)} {...props} />;
}

export function PanelHeader({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={joinClasses(CLASS.panelHeader, className)} {...props} />;
}

export function PanelBody({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={joinClasses(CLASS.panelBody, className)} {...props} />;
}

export function PanelFooter({ className = "", ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={joinClasses(CLASS.panelFooter, className)} {...props} />;
}

export function SurfaceGrid({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={joinClasses(CLASS.surface, CLASS.grid, className)} {...props} />;
}

export function GridCell({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={joinClasses(CLASS.gridCell, className)} {...props} />;
}

export function Label({ children }: { children: ReactNode }) {
  return <span className={CLASS.label}>{children}</span>;
}

export function Copy({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={className}>{children}</p>;
}

export function Link({ children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a {...props}>{children}</a>;
}

/** A shared interactive atom. Feature surfaces supply semantic intent, never page-local button styling. */
export function ActionButton({
  className = "",
  type = "button",
  intent = "neutral",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { intent?: "neutral" | "edit" | "add" | "show" | "hide" | "publish" | "danger" }) {
  return <Atom as="button" type={type} data-intent={intent} className={joinClasses(CLASS.button, className)} {...props} />;
}

export function FormField({
  label,
  children,
  className = "",
  ...props
}: { label: ReactNode; children: ReactNode; className?: string } & Omit<ComponentPropsWithoutRef<"label">, "children" | "className">) {
  return <Atom as="label" className={className} {...props}><Label>{label}</Label>{children}</Atom>;
}

export function FieldGroup({
  label,
  children,
  className = "",
  ...props
}: { label: ReactNode; children: ReactNode; className?: string } & Omit<FieldsetHTMLAttributes<HTMLFieldSetElement>, "children" | "className">) {
  return <fieldset className={joinClasses(CLASS.fieldGroup, className)} {...props}><legend><Label>{label}</Label></legend>{children}</fieldset>;
}

export function SelectionCard({
  selected,
  className = "",
  ...props
}: HTMLAttributes<HTMLDivElement> & { selected: boolean }) {
  return <Surface className={joinClasses(CLASS.selectionCard, className)} data-selected={selected} {...props} />;
}

/** A shared iframe atom for persisted product-model assets and their fixed web-only graphics. */
export function ModelPreviewFrame({ className = "", compact = false, loading = "lazy", labelPayload, src = "", ...props }: IframeHTMLAttributes<HTMLIFrameElement> & { compact?: boolean; labelPayload?: ThreeDLabelPayload }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const frameSrc = compact && src ? `${src}${src.includes("?") ? "&" : "?"}compact=1` : src;
  useEffect(() => { sendLabelPayloadToFrame(frameRef.current, labelPayload, frameSrc); }, [labelPayload, frameSrc]);
  return <iframe ref={frameRef} onLoad={() => sendLabelPayloadToFrame(frameRef.current, labelPayload, frameSrc)} className={joinClasses(CLASS.modelPreviewFrame, className)} loading={loading} src={frameSrc} {...props} />;
}

/** The selectable portion of a card stays keyboard-operable without nesting action buttons. */
export function SelectionCardControl({ className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <ActionButton className={joinClasses(CLASS.selectionCardControl, className)} {...props} />;
}

/** A relationship list keeps model-to-SKU associations readable without previewing every asset. */
export function AssociationList({ className = "", ...props }: HTMLAttributes<HTMLUListElement>) {
  return <ul className={joinClasses(CLASS.associationList, className)} {...props} />;
}

export function AssociationRow({ selected = false, className = "", ...props }: HTMLAttributes<HTMLLIElement> & { selected?: boolean }) {
  return <li className={joinClasses(CLASS.associationRow, className)} data-selected={selected} {...props} />;
}

/** Product model cards have their own responsive collection; association rows remain relationship-list primitives. */
export function AssetLibraryGrid({ className = "", ...props }: HTMLAttributes<HTMLUListElement>) {
  return <ul className={joinClasses(CLASS.assetLibraryGrid, className)} {...props} />;
}

export function AssetLibraryCard({ selected = false, className = "", ...props }: HTMLAttributes<HTMLLIElement> & { selected?: boolean }) {
  return <li className={joinClasses(CLASS.assetLibraryCard, className)} data-selected={selected} {...props} />;
}

export function AssetIdentity({ children, className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={joinClasses(CLASS.assetIdentity, className)} {...props}>{children}</div>;
}

/** Keeps an asset name and its lifecycle status in one compact, aligned row. */
export function AssetIdentityHeader({ children, className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={joinClasses(CLASS.assetIdentityHeader, className)} {...props}>{children}</div>;
}

/** Recursive product assets remain a semantic list rather than a fake ARIA tree. */
export function AssetHierarchy({ className = "", ...props }: HTMLAttributes<HTMLUListElement>) {
  return <ul className={joinClasses(CLASS.assetHierarchy, className)} {...props} />;
}

export function AssetHierarchyItem({ className = "", ...props }: HTMLAttributes<HTMLLIElement>) {
  return <li className={joinClasses(CLASS.assetHierarchyItem, className)} {...props} />;
}

export function AssetNodeActions({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={joinClasses(CLASS.assetNodeActions, className)} role="group" {...props} />;
}

export function AssetEditContext({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <Surface className={joinClasses(CLASS.assetEditContext, className)} {...props} />;
}

export function InlineAssetEditor({ className = "", ...props }: HTMLAttributes<HTMLFormElement>) {
  return <form className={joinClasses(CLASS.inlineAssetEditor, className)} {...props} />;
}

export function DestructiveActionGate({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <Surface className={joinClasses(CLASS.destructiveActionGate, className)} role="alert" {...props} />;
}

export function AssetEmptyState({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <Surface className={joinClasses(CLASS.assetEmptyState, className)} {...props} />;
}

/** Keeps a modeling workspace's identity inside the workspace instead of creating a second page-level header. */
export function ModelingWorkspaceIntro({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={joinClasses(CLASS.modelingWorkspaceIntro, className)} {...props} />;
}

/** A non-visual section layout that keeps the studio, library, and output regions as direct siblings. */
export function ModelingCatalogLayout({ className = "", ...props }: HTMLAttributes<HTMLElement>) {
  return <Container as={ELEMENT.section} className={joinClasses(CLASS.section, CLASS.modelingCatalogLayout, className)} {...props} />;
}

/** The single, route-level modeling preview sits between navigation and the studio/library workspace. */
export function ModelingPreviewStage({ className = "", ...props }: HTMLAttributes<HTMLElement>) {
  return <Container as={ELEMENT.section} className={joinClasses(CLASS.section, CLASS.modelingPreviewStage, className)} {...props} />;
}

/** Layout-only composition for the form and its mutually exclusive decision or result workspace. */
export function ModelingStudio({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={joinClasses(CLASS.modelingStudio, className)} {...props} />;
}

/** The product asset library is a first-class surface, rather than a page-local wrapper. */
export function ModelingLibraryWorkspace({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <Surface className={joinClasses(CLASS.modelingLibraryWorkspace, className)} {...props} />;
}

/** Separates the active parent's hierarchy from the library's parent card grid. */
export function ModelingLibraryTree({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={joinClasses(CLASS.modelingLibraryTree, className)} {...props} />;
}

/** Layout-only grouping for model output surfaces. */
export function ModelingOutputSections({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={joinClasses(CLASS.modelingOutputSections, className)} {...props} />;
}

export function WorkflowStepper({ children }: { children: ReactNode }) { return <div className={CLASS.workflowStepper}>{children}</div>; }
export function ProposalCard({ children }: { children: ReactNode }) { return <Surface className={CLASS.proposalCard}>{children}</Surface>; }
export function ParameterEditor({ children }: { children: ReactNode }) { return <div className={CLASS.parameterEditor}>{children}</div>; }
export function EvidencePreview({ children }: { children: ReactNode }) { return <div className={CLASS.evidencePreview}>{children}</div>; }
export function ReviewStatus({ children }: { children: ReactNode }) { return <span className={CLASS.reviewStatus}>{children}</span>; }
export function ReviewProgress({ children }: { children: ReactNode }) { return <div className={CLASS.reviewProgress}>{children}</div>; }
export function DecisionActions({ children }: { children: ReactNode }) { return <div className={CLASS.decisionActions}>{children}</div>; }
export function ReviewWorkspace({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) { return <Surface className={joinClasses(CLASS.reviewWorkspace, className)} {...props} />; }
export function ReviewWorkspaceHeader({ className = "", ...props }: HTMLAttributes<HTMLElement>) { return <header className={joinClasses(CLASS.reviewWorkspaceHeader, className)} {...props} />; }
export function WorkflowStep({ status, className = "", ...props }: HTMLAttributes<HTMLDivElement> & { status: "completed" | "current" | "upcoming" }) { return <div className={joinClasses(CLASS.workflowStep, className)} data-status={status} {...props} />; }
export function ParameterGroup({ label, children }: { label: ReactNode; children: ReactNode }) { return <section className={CLASS.parameterGroup}><Label>{label}</Label><div>{children}</div></section>; }
export function ParameterQuestionCard({ status, className = "", ...props }: HTMLAttributes<HTMLElement> & { status: string }) { return <article className={joinClasses(CLASS.parameterQuestionCard, className)} data-status={status} {...props} />; }
export function ParameterValue({ children }: { children: ReactNode }) { return <div className={CLASS.parameterValue}>{children}</div>; }
export function ParameterValueField({ state = "pristine", className = "", ...props }: HTMLAttributes<HTMLDivElement> & { state?: "pristine" | "modified" | "saving" | "overridden" | "invalid" | "conflict" }) { return <div className={joinClasses(CLASS.parameterValueField, className)} data-value-state={state} {...props} />; }
export function BuildGate({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) { return <div className={joinClasses(CLASS.buildGate, className)} {...props} />; }
export function BuildProgressPanel({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) { return <Surface className={joinClasses(CLASS.buildProgressPanel, className)} aria-live="polite" {...props} />; }
export function ModelResultPanel({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) { return <Surface className={joinClasses(CLASS.modelResultPanel, className)} {...props} />; }
export function DecisionHistoryDisclosure({ label, children }: { label: ReactNode; children: ReactNode }) { return <details className={CLASS.decisionHistoryDisclosure}><summary>{label}</summary><div>{children}</div></details>; }
/** Keyboard-operable scope navigation for the product/assembly and component approval panels. */
export function ReviewScopeNavigator({ children, ...props }: HTMLAttributes<HTMLDivElement>) { return <div className={CLASS.reviewScopeNavigator} role="tablist" aria-label="승인 범위" {...props}>{children}</div>; }
export function ReviewScopeControl({ active, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { active: boolean }) { return <ActionButton className={CLASS.reviewScopeControl} role="tab" aria-selected={active} data-active={active} {...props}>{children}</ActionButton>; }
export function ReviewStageNavigator({ children, ...props }: HTMLAttributes<HTMLDivElement>) { return <div className={CLASS.reviewStageNavigator} role="tablist" aria-label="검토 단계" {...props}>{children}</div>; }
export function ReviewStageControl({ active, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { active: boolean }) { return <ActionButton className={CLASS.reviewStageControl} role="tab" aria-selected={active} data-active={active} {...props}>{children}</ActionButton>; }
export function GraphBindingSummary({ children, ...props }: HTMLAttributes<HTMLDivElement>) { return <div className={CLASS.graphBindingSummary} {...props}>{children}</div>; }
/** Approves only the still-proposed questions in the currently visible scope. */
export function ScopedApprovalBar({ children, ...props }: HTMLAttributes<HTMLDivElement>) { return <div className={CLASS.scopedApprovalBar} {...props}>{children}</div>; }
/** Measured server stages; callers provide counts only when the work has a real count. */
export function ProcessProgressPanel({ children, ...props }: HTMLAttributes<HTMLDivElement>) { return <Surface className={CLASS.processProgressPanel} aria-live="polite" {...props}>{children}</Surface>; }
export function ProgressStageList({ children, ...props }: HTMLAttributes<HTMLOListElement>) { return <ol className={CLASS.progressStageList} {...props}>{children}</ol>; }
export function ProgressStage({ state, children, ...props }: HTMLAttributes<HTMLLIElement> & { state: "queued" | "running" | "complete" | "failed" }) { return <li className={CLASS.progressStage} data-state={state} {...props}>{children}</li>; }
/** Safe building blocks for a server-validated vector sketch and user markup. */
export function SketchReviewPanel({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) { return <Surface className={joinClasses(CLASS.sketchReviewPanel, className)} {...props} />; }
export function SketchCanvas({ className = "", ...props }: SVGAttributes<SVGSVGElement>) { return <svg className={joinClasses(CLASS.sketchCanvas, className)} {...props} />; }
export function SketchAnnotationLayer({ children, ...props }: SVGAttributes<SVGGElement>) { return <g className={CLASS.sketchAnnotationLayer} {...props}>{children}</g>; }
export function SketchViewNavigator({ children, ...props }: HTMLAttributes<HTMLDivElement>) { return <div className={CLASS.sketchViewNavigator} role="tablist" aria-label="B-Rep 검토 보기" {...props}>{children}</div>; }
export function SketchComponentLegend({ children, ...props }: HTMLAttributes<HTMLUListElement>) { return <ul className={CLASS.sketchComponentLegend} {...props}>{children}</ul>; }
export function PenToolbar({ children, ...props }: HTMLAttributes<HTMLDivElement>) { return <div className={CLASS.penToolbar} role="toolbar" aria-label="스케치 주석 도구" {...props}>{children}</div>; }
export function IterationNavigator({ children, ...props }: HTMLAttributes<HTMLDivElement>) { return <div className={CLASS.iterationNavigator} aria-label="스케치 검토 이력" {...props}>{children}</div>; }

type ErrorBoundaryProps = { children: ReactNode; fallback: ReactNode };
type ErrorBoundaryState = { failed: boolean };

/** Keeps a failed 3D/sketch preview from unmounting the modeling form and decision workspace. */
export class PreviewErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false };
  static getDerivedStateFromError(): ErrorBoundaryState { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("[NET30] preview failed", error, info); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

/** Last-resort application boundary; feature boundaries should handle recoverable failures first. */
export class ApplicationErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false };
  static getDerivedStateFromError(): ErrorBoundaryState { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("[NET30] application failed", error, info); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export function SiteHeader({
  label,
  brand,
  brandHref,
  navigation,
  bagHref,
  bagLabel,
  bagCount,
  dot,
}: {
  label: string;
  brand: string;
  brandHref: string;
  navigation: readonly { label: string; href: string }[];
  bagHref: string;
  bagLabel: string;
  bagCount: number;
  dot: string;
}) {
  return <Container as={ELEMENT.nav} className={CLASS.nav} aria-label={label}>
    <Link className={CLASS.brand} href={brandHref}>{brand}</Link>
    <div>{navigation.map((item) => <Link href={item.href} key={item.href}>{item.label}</Link>)}</div>
    <Link className={CLASS.navBag} href={bagHref}>{bagLabel}{dot}{bagCount}</Link>
  </Container>;
}

export function SiteFooter({ tagline, location }: { tagline: string; location: string }) {
  return <Container as={ELEMENT.footer} className={CLASS.footer}>
    <Copy>{tagline}</Copy>
    <span>{location}</span>
  </Container>;
}

export function LabeledChoice({
  code,
  name,
  detail,
  selected,
  onClick,
  className = "",
  visual,
}: {
  code: string;
  name: string;
  detail: string;
  selected: boolean;
  onClick: () => void;
  className?: string;
  visual?: ReactNode;
}) {
  return <button className={joinClasses(CLASS.choice, className)} aria-pressed={selected} onClick={onClick}>
    <span className={CLASS.choiceCode}>{code}</span>
    {visual && <div className={CLASS.choiceVisual}>{visual}</div>}
    <div className={CLASS.choiceContent}><strong>{name}</strong><small>{detail}</small></div>
  </button>;
}

export function SectionHeading({
  label,
  title,
  copy,
  aside,
}: {
  label: string;
  title: readonly string[];
  copy: readonly string[];
  aside?: ReactNode;
}) {
  return <header className={CLASS.sectionHead}>
    <div><Label>{label}</Label><h2><Lines value={title} /></h2></div>
    <p><Lines value={copy} /></p>
    {aside}
  </header>;
}

export function Metric({ label, value, suffix }: { label: string; value: ReactNode; suffix?: string }) {
  return <GridCell className={CLASS.metric}>
    <Label>{label}</Label><strong>{value}</strong>{suffix && <small>{suffix}</small>}
  </GridCell>;
}

export const Sticker = forwardRef<HTMLDivElement, { label: string; children: ReactNode }>(
  function Sticker({ label, children }, ref) {
    return <div ref={ref} className={CLASS.labelSticker} aria-label={label}>{children}</div>;
  },
);

export function StickerSheet({ label, children }: { label: string; children: ReactNode }) {
  return <article className={joinClasses(CLASS.surface, CLASS.labelStickerSheet)} aria-label={label}>{children}</article>;
}

export function StickerHeader({ badge, title, aside }: { badge: string; title: string; aside?: ReactNode }) {
  return <header className={CLASS.labelStickerHead}>
    {badge ? <span className={CLASS.labelStickerBadge}>{badge}</span> : null}
    <h3 className={CLASS.labelStickerTitle}>{title}</h3>
    {aside && <strong className={CLASS.labelStickerValue}>{aside}</strong>}
  </header>;
}

export function StickerSection({
  title,
  children,
  collapsible = false,
}: {
  title?: string;
  children: ReactNode;
  collapsible?: boolean;
}) {
  if (title && collapsible) {
    return <details className={CLASS.labelStickerSection}>
      <summary className={CLASS.labelStickerSectionTitle}>{title}</summary>
      {children}
    </details>;
  }
  return <section className={CLASS.labelStickerSection}>
    {title && <strong className={CLASS.labelStickerSectionTitle}>{title}</strong>}
    {children}
  </section>;
}

export function StickerRows({ children }: { children: ReactNode }) {
  return <div className={CLASS.labelStickerRows}>{children}</div>;
}

export function StickerField({ label, value }: { label: string; value: ReactNode }) {
  return <div className={CLASS.labelStickerRow}>
    <span className={CLASS.labelStickerField}>{label}</span>
    <strong className={CLASS.labelStickerValue}>{value}</strong>
  </div>;
}

export function StickerCopy({ children }: { children: ReactNode }) {
  return <p className={CLASS.labelStickerCopy}>{children}</p>;
}

export function StickerCostRows({ children }: { children: ReactNode }) {
  return <div className={CLASS.labelStickerCostRows}>{children}</div>;
}

export function StickerCostHeader({ columns }: { columns: readonly string[] }) {
  return <div className={CLASS.labelStickerCostHeader}>{columns.map((column) => <strong key={column}>{column}</strong>)}</div>;
}

export function StickerCostRow({
  name,
  meta,
  money,
  ratio,
  gaugeStart,
  gaugeSize,
  as = "div",
}: {
  name: string;
  meta?: string;
  money: string;
  ratio: string;
  gaugeStart: number;
  gaugeSize: number;
  as?: "div" | "summary";
}) {
  const Tag = as;
  return <Tag className={CLASS.labelStickerCostRow}>
    <strong className={CLASS.labelStickerCostName}>{name}</strong>
    <span className={CLASS.labelStickerCostMeta} title={meta || undefined}>{meta}</span>
    <i className={CLASS.labelStickerCostGauge}><b style={{ left: `${gaugeStart}%`, width: `${gaugeSize}%` }} /></i>
    <strong className={CLASS.labelStickerCostAmount}>{money}</strong>
    <span>{ratio}</span>
  </Tag>;
}

export function StickerCostGroup({
  name,
  meta,
  money,
  ratio,
  gaugeStart,
  gaugeSize,
  children,
}: {
  name: string;
  meta?: string;
  money: string;
  ratio: string;
  gaugeStart: number;
  gaugeSize: number;
  children?: ReactNode;
}) {
  if (children) {
    return <details className={CLASS.labelStickerCostDetail}>
      <StickerCostRow
        as="summary"
        name={name}
        meta={meta}
        money={money}
        ratio={ratio}
        gaugeStart={gaugeStart}
        gaugeSize={gaugeSize}
      />
      <div className={CLASS.labelStickerCostSummary}>{children}</div>
    </details>;
  }
  return <div className={CLASS.labelStickerCostDetail}>
    <StickerCostRow name={name} meta={meta} money={money} ratio={ratio} gaugeStart={gaugeStart} gaugeSize={gaugeSize} />
  </div>;
}

export function KoreanSupplementLabel({
  definition,
  locale,
  currencyMark,
  percentMark,
  rootRef,
}: {
  definition: KoreanSupplementLabelDefinition;
  locale: string;
  currencyMark: string;
  percentMark: string;
  rootRef?: Ref<HTMLDivElement>;
}) {
  const money = (value: number) => `${currencyMark}${value.toLocaleString(locale)}`;
  const ratio = (value: number, precision = 1) => `${(value / definition.consumerPrice * 100).toFixed(precision)}${percentMark}`;
  const ingredientTotal = definition.ingredients.reduce((sum, item) => sum + item.cost, 0);
  const costTotal = definition.costs.reduce((sum, item) => sum + item.amount, 0);
  const displayedTotal = ingredientTotal + costTotal;
  const renderField = (field: { label: string; value: string }) => (
    <StickerField label={field.label} value={field.value} key={`${field.label}-${field.value}`} />
  );
  let groupOffset = 0;
  const costGroups = definition.costGroups.map((group) => {
    const items = group.id === "ingredient"
      ? definition.ingredients.map((item) => ({ id: item.id, name: item.name, meta: item.amount, value: item.cost }))
      : definition.costs
          .filter((item) => item.group === group.id)
          .map((item) => ({ id: item.id, name: item.label, meta: item.detail ?? "", value: item.amount }));
    const total = items.reduce((sum, item) => sum + item.value, 0);
    const start = groupOffset;
    const size = total / definition.consumerPrice * 100;
    groupOffset += size;
    let childOffset = start;
    const children = items.map((item) => {
      const childSize = item.value / definition.consumerPrice * 100;
      const row = <StickerCostRow
        name={item.name}
        meta={item.meta}
        money={money(item.value)}
        ratio={ratio(item.value)}
        gaugeStart={childOffset}
        gaugeSize={childSize}
        key={item.id}
      />;
      childOffset += childSize;
      return row;
    });
    const hasChildren = items.length > 1;
    const groupMeta = hasChildren
      ? `${items.length.toLocaleString(locale)}개 세부 항목`
      : items[0]?.meta || undefined;
    return <StickerCostGroup
      name={group.label}
      meta={groupMeta}
      money={money(total)}
      ratio={ratio(total, group.id === "profit" ? 2 : 1)}
      gaugeStart={start}
      gaugeSize={size}
      key={group.id}
    >
      {hasChildren ? <StickerCostRows>{children}</StickerCostRows> : undefined}
    </StickerCostGroup>;
  });

  return <Sticker ref={rootRef} label={definition.title}>
    <StickerSheet label={definition.title}>
      <StickerHeader badge={definition.badge} title={definition.title} />
      <StickerSection><StickerRows>{definition.identification.map(renderField)}</StickerRows></StickerSection>
      {definition.sections.map((section) => <StickerSection title={section.title} collapsible key={section.id}>
        {section.fields && <StickerRows>{section.fields.map(renderField)}</StickerRows>}
        {section.copy?.map((line) => <StickerCopy key={line}>{line}</StickerCopy>)}
      </StickerSection>)}
      <StickerSection title={definition.ingredientsTitle} collapsible>
        <StickerCopy>{definition.ingredients.map((item) => `${item.name}(${item.amount})`).join(", ")}</StickerCopy>
      </StickerSection>
      {definition.notices.length > 0 && <StickerSection>
        {definition.notices.map((line) => <StickerCopy key={line}>{line}</StickerCopy>)}
      </StickerSection>}
    </StickerSheet>
    <StickerSheet label={definition.costsTitle}>
      <StickerHeader badge={definition.badge} title={definition.costsTitle} aside={money(displayedTotal)} />
      <StickerSection>
        <StickerCostHeader columns={definition.costColumns} />
        <StickerCostRows>{costGroups}</StickerCostRows>
      </StickerSection>
    </StickerSheet>
  </Sticker>;
}

export function TeeSilhouette({
  compact = false,
  variant = "crew",
}: {
  compact?: boolean;
  variant?: "crew" | "relaxed" | "pocket";
}) {
  const variantClass = variant === "relaxed" ? CLASS.teeRelaxed : variant === "pocket" ? CLASS.teePocket : undefined;
  return <div className={joinClasses(CLASS.tee, variantClass, compact && CLASS.teeCompact)} aria-hidden="true">
    <i />{variant === "pocket" && <b />}
  </div>;
}

export function ProductVisual({
  visual,
  compact = false,
  labelPayload,
  modelAssetPath,
  runtimeState,
}: {
  visual: ProductVisualDefinition;
  compact?: boolean;
  labelPayload?: ThreeDLabelPayload;
  modelAssetPath?: string | null;
  runtimeState?: "loading" | "unassigned" | "empty" | "ready";
}) {
  if (visual.kind === "image") {
    return <Atom as={ELEMENT.image} className={CLASS.productImage} data-compact={compact} src={visual.src} alt={visual.alt} />;
  }
  if (visual.kind === "threeD") {
    return <ThreeDModel visual={visual} compact={compact} labelPayload={labelPayload} modelAssetPath={modelAssetPath} runtimeState={runtimeState} />;
  }
  return <TeeSilhouette compact={compact} variant={visual.variant} />;
}

export function GlobeRoot(props: HTMLAttributes<HTMLDivElement>) {
  return <div className={CLASS.globe} {...props} />;
}

export const GlobeInteraction = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function GlobeInteraction(props, ref) {
    return <div ref={ref} className={CLASS.globeInteraction} {...props} />;
  },
);

export const GlobeCanvas = forwardRef<HTMLCanvasElement, CanvasHTMLAttributes<HTMLCanvasElement>>(
  function GlobeCanvas(props, ref) {
    return <canvas ref={ref} {...props} />;
  },
);

export function GlobeOverlay({
  kind,
  anchor,
  opacity,
  children,
}: {
  kind: "node" | "cost";
  anchor: string;
  opacity: string;
  children: ReactNode;
}) {
  return <div
    className={kind === "node" ? CLASS.globeNode : CLASS.globeCost}
    style={{ positionAnchor: anchor, opacity } as CSSProperties}
  >{children}</div>;
}

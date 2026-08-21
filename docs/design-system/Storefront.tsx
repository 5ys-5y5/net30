"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ElementType, FormEvent, PointerEvent as ReactPointerEvent, ReactNode, RefObject } from "react";
import {
  ActionButton,
  Atom,
  Container,
  Copy,
  FieldGroup,
  FormField,
  GridCell,
  KoreanSupplementLabel,
  Label,
  LabeledChoice,
  Link,
  ModelPreviewFrame,
  AssetLibraryGrid,
  AssetLibraryCard,
  AssetIdentity,
  AssetHierarchy,
  AssetHierarchyItem,
  AssetNodeActions,
  AssetEditContext,
  InlineAssetEditor,
  DestructiveActionGate,
  AssetEmptyState,
  ModelingWorkspaceIntro,
  ModelingPreviewStage,
  ModelingCatalogLayout,
  ModelingStudio,
  ModelingLibraryWorkspace,
  ModelingLibraryTree,
  ModelingOutputSections,
  Metric,
  Panel,
  PanelBody,
  PanelFooter,
  PanelHeader,
  ProductVisual,
  SectionHeading,
  SelectionCard,
  SelectionCardControl,
  SiteFooter,
  SiteHeader,
  Surface,
  SurfaceGrid,
  WorkflowStepper,
  ProposalCard,
  ParameterEditor,
  EvidencePreview,
  ReviewStatus,
  ReviewProgress,
  DecisionActions,
  ReviewWorkspace,
  ReviewWorkspaceHeader,
  WorkflowStep,
  ParameterGroup,
  ParameterQuestionCard,
  ParameterValue,
  BuildGate,
  BuildProgressPanel,
  ModelResultPanel,
  DecisionHistoryDisclosure,
  ReviewScopeNavigator,
  ReviewScopeControl,
  ScopedApprovalBar,
  ProcessProgressPanel,
  ProgressStageList,
  ProgressStage,
  SketchReviewPanel,
  SketchCanvas,
  SketchAnnotationLayer,
  PenToolbar,
  IterationNavigator,
} from "./index";
import { mergeComponentVersions } from "./modeling-library-state";
import { renderLabelStickerToTexture } from "./render-label-texture";
import { SupplyGlobe } from "./SupplyGlobe";
import { CLASS, ELEMENT, joinClasses, ROLE } from "./tokens";
import { selectCombination } from "./sku";
import type {
  HeroTextDefinition,
  ProductPageDefinition,
  RenderedLabelTexture,
  TemplateRegion,
  ThreeDLabelPayload,
} from "./schema";

type ActiveRenderedLabel = {
  primaryId: string;
  payload?: ThreeDLabelPayload;
  modelAssetPath: string | null;
  runtimeState: "loading" | "unassigned" | "empty" | "ready";
};

type CapturedTexture = {
  sourceKey: string;
  texture: RenderedLabelTexture;
};

type ModelingLibraryVersion = {
  id: string;
  ordinal: number;
  summary: string;
  createdAt: string;
  assetPath: string;
};

type ModelingDraftQuestion = { id: string; scope: string; componentInstanceId?: string; appliesToComponentIds?: readonly string[]; path: string; category: string; valueType: string; unit?: string; recommendedValue: unknown; rationale: string; evidence?: readonly { kind: string; label: string }[]; dependencies?: readonly string[]; criticality: string; required: boolean; status: string; userValue?: unknown };
type ModelingProgress = { eventId: number; operation: "analysis" | "approval" | "build"; stage: string; state: "queued" | "running" | "complete" | "failed"; completed?: number; total?: number; unit?: "files" | "components" | "questions"; componentInstanceId?: string; message: string };
type SketchPlan = { width: number; height: number; title: string; components: readonly { id: string; label: string; shape: string; x: number; y: number; width: number; height: number; color: string; note: string }[]; annotations: readonly { label: string; x: number; y: number }[] };
type SketchStroke = { id: string; color: string; points: readonly { x: number; y: number }[] };
type SketchIteration = { id: string; ordinal: number; status: "proposed" | "approved" | "superseded"; prompt: string; markup?: readonly SketchStroke[]; markupRevision?: number; plan: SketchPlan };
type ModelingDraft = { id: string; revision: number; state: string; message: string; parentModelId?: string; input: { operation?: string; parentModelId?: string; requestedComponents?: readonly string[]; componentInput?: string; revisionBaseRefs?: Record<string, { versionId: string }>; assemblyAssetRefs?: readonly { versionId: string }[] }; product: { name: string; intendedUse?: string } | null; components: readonly { id: string; requestedName?: string; displayName: string; semanticRole: string; quantity: number; recipe: string; summary?: string }[]; questions: readonly ModelingDraftQuestion[]; iterations?: readonly SketchIteration[]; activeIterationId?: string | null; progress?: readonly ModelingProgress[]; approval?: { ready: boolean; blockers: readonly string[]; approvalHash: string; compiler?: { ready: boolean }; sketchReady?: boolean } };
type ProductModel = { id: string; name: string; parentId?: string | null; revision: number; linkedSkuId: string | null; currentRevision: { id: string; ordinal: number; state: string; childCount: number; assetPath?: string | null } | null; publishedRevision: { id: string; ordinal: number } | null; directChildren: number; descendantCount: number; status: "empty" | "ready" | "unpublished" | "published" | "failed" | "archived" | string; archivedAt?: string | null; updatedAt: string };
type ProductModelTree = ProductModel & { selectedRevision: { id: string; ordinal: number; assetPath?: string | null; childCount: number }; children: readonly { id: string; path: string; modelId: string; revisionId: string; order: number; transform: unknown; model: ProductModelTree }[] };
type AssetEditTarget = { mode: "refine-assembly" | "refine-node" | "add-child"; rootModelId: string; baseRootRevisionId: string; targetModelId?: string; baseTargetRevisionId?: string; targetChildRefIds?: readonly string[]; label: string };
type FocusedAsset = { kind: "parent"; parentId: string; revisionId: string; assetPath: string | null } | { kind: "child"; parentId: string; path: string; childRefId: string; revisionId: string; assetPath: string | null } | null;
type FlatAssetNode = { child: ProductModelTree["children"][number]; path: string; depth: number; breadcrumb: readonly string[] };

const MODELING_WORKFLOW_STEPS = ["제품 확인", "구성 부품", "기준값", "Blender 생성"] as const;
const PARAMETER_LABELS: Readonly<Record<string, string>> = {
  name: "제품명", widthMm: "전체 폭", heightMm: "전체 높이", depthMm: "전체 깊이", wallMm: "벽 두께", bottomMm: "바닥 두께",
  profile: "회전 단면", material: "재질", transform: "조립 위치", outerDiameterMm: "외경", innerDiameterMm: "내경", ribCount: "리브 수",
  ribDepthMm: "리브 깊이", interfaceId: "결합 인터페이스", hostComponentId: "부착 대상", physicalWidthMm: "그래픽 폭", physicalHeightMm: "그래픽 높이",
  wrapDegrees: "감김 각도", surfaceOffsetMm: "표면 간격", quantity: "수량", distribution: "배치 방식", dimensionsMm: "치수",
};

function workflowIndex(state: string, complete: boolean) {
  if (complete) return MODELING_WORKFLOW_STEPS.length;
  if (["building", "validating"].includes(state)) return 3;
  if (state === "ready_to_build") return 3;
  if (["analyzing_parameters", "awaiting_parameter_review"].includes(state)) return 2;
  if (["analyzing_components", "awaiting_component_review"].includes(state)) return 1;
  return 0;
}

function parameterLabel(question: ModelingDraftQuestion) {
  const leaf = question.path.split(".").at(-1) ?? question.path;
  return PARAMETER_LABELS[leaf] ?? leaf.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function parameterValue(question: ModelingDraftQuestion) {
  const value = question.userValue ?? question.recommendedValue;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return `${String(value)}${question.unit ? ` ${question.unit}` : ""}`;
  if (value && typeof value === "object" && !Array.isArray(value)) return Object.entries(value as Record<string, unknown>).map(([key, item]) => `${key === "name" ? "재질명" : PARAMETER_LABELS[key] ?? key}: ${typeof item === "object" ? JSON.stringify(item) : String(item)}`).join("\n");
  return `${JSON.stringify(value, null, 2)}${question.unit ? ` ${question.unit}` : ""}`;
}

function flattenAssetTree(root: ProductModelTree): readonly FlatAssetNode[] {
  const items: FlatAssetNode[] = [];
  const visit = (children: readonly ProductModelTree["children"][number][], depth: number, names: readonly string[], fallbackPrefix: string) => {
    for (const child of children) {
      const path = child.path || (fallbackPrefix ? `${fallbackPrefix}/${child.id}` : child.id);
      const breadcrumb = [...names, child.model.name];
      items.push({ child, path, depth, breadcrumb });
      visit(child.model.children, depth + 1, breadcrumb, path);
    }
  };
  visit(root.children, 0, [root.name], "");
  return items;
}

function groupDraftQuestions(draft: ModelingDraft, questions = draft.questions) {
  const componentNames = new Map(draft.components.map((component) => [component.id, component.displayName]));
  const groups = new Map<string, { label: string; questions: ModelingDraftQuestion[] }>();
  for (const question of questions) {
    const scopeLabel = question.componentInstanceId ? componentNames.get(question.componentInstanceId) ?? "구성 부품" : question.scope === "sticker-slot" ? "고정 HTML 그래픽 슬롯" : "제품·조립 기준";
    const key = `${scopeLabel}:${question.category}`;
    const group = groups.get(key) ?? { label: `${scopeLabel} · ${question.category}`, questions: [] };
    group.questions.push(question); groups.set(key, group);
  }
  return [...groups.values()];
}

function DraftQuestionGroups({ draft, questions, readOnly = false, decisionPending = false, onDecision }: { draft: ModelingDraft; questions?: readonly ModelingDraftQuestion[]; readOnly?: boolean; decisionPending?: boolean; onDecision?: (question: ModelingDraftQuestion, action: "accept" | "override" | "needs_evidence", value?: unknown) => void }) {
  const [edits, setEdits] = useState<Record<string, string>>({});
  return <ParameterEditor>{groupDraftQuestions(draft, questions).map((group) => <ParameterGroup label={group.label} key={group.label}>{group.questions.map((question) => <ParameterQuestionCard status={question.status} key={question.id}>
    <div>
      <Label>{question.criticality} · {question.status}</Label>
      <h3>{parameterLabel(question)}</h3>
      <Copy>{question.rationale}</Copy>
      <ParameterValue>{parameterValue(question)}</ParameterValue>
      {question.evidence?.length ? <EvidencePreview>{question.evidence.map((item) => <Copy key={`${question.id}-${item.kind}-${item.label}`}>{item.kind} · {item.label}</Copy>)}</EvidencePreview> : null}
      <code>{question.path}</code>
    </div>
    {!readOnly && onDecision ? <DecisionActions>
      <ActionButton className={CLASS.modelingAction} disabled={decisionPending || ["accepted", "overridden"].includes(question.status)} onClick={() => onDecision(question, "accept")}>승인</ActionButton>
      <FormField label="수정값"><input className={CLASS.modelingControl} value={edits[question.id] ?? String(question.userValue ?? question.recommendedValue ?? "")} onChange={(event) => setEdits((current) => ({ ...current, [question.id]: event.target.value }))} /></FormField>
      <ActionButton className={CLASS.modelingAction} disabled={decisionPending} onClick={() => onDecision(question, "override", edits[question.id] ?? question.userValue ?? question.recommendedValue)}>수정 저장</ActionButton>
      <ActionButton className={CLASS.modelingAction} disabled={decisionPending} onClick={() => onDecision(question, "needs_evidence")}>근거 요청</ActionButton>
    </DecisionActions> : null}
  </ParameterQuestionCard>)}</ParameterGroup>)}</ParameterEditor>;
}

const PEN_COLORS = [
  { id: "#be123c", label: "형상 보정" },
  { id: "#2563eb", label: "치수·비율" },
  { id: "#15803d", label: "재질·표면" },
  { id: "#c2410c", label: "조립·결합" },
] as const;

function SketchReview({ draft, pending, onSave, onFeedback, onApprove }: { draft: ModelingDraft; pending: boolean; onSave: (iteration: SketchIteration, strokes: readonly SketchStroke[]) => void; onFeedback: (iteration: SketchIteration, prompt: string) => void; onApprove: (iteration: SketchIteration) => void }) {
  const iteration = draft.iterations?.find((item) => item.id === draft.activeIterationId) ?? null;
  const [strokes, setStrokes] = useState<readonly SketchStroke[]>(iteration?.markup ?? []);
  const [color, setColor] = useState<string>(PEN_COLORS[0].id);
  const [feedback, setFeedback] = useState("");
  const activeStroke = useRef<string | null>(null);
  useEffect(() => { setStrokes(iteration?.markup ?? []); setFeedback(""); }, [iteration?.id]);
  if (!iteration) return null;
  const point = (event: ReactPointerEvent<SVGSVGElement>) => { const box = event.currentTarget.getBoundingClientRect(); return { x: Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)), y: Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)) }; };
  const begin = (event: ReactPointerEvent<SVGSVGElement>) => { if (iteration.status !== "proposed") return; const id = `stroke-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; activeStroke.current = id; event.currentTarget.setPointerCapture(event.pointerId); setStrokes((current) => [...current, { id, color, points: [point(event)] }]); };
  const draw = (event: ReactPointerEvent<SVGSVGElement>) => { const id = activeStroke.current; if (!id) return; const next = point(event); setStrokes((current) => current.map((stroke) => stroke.id === id ? { ...stroke, points: [...stroke.points, next].slice(-300) } : stroke)); };
  const end = () => { activeStroke.current = null; };
  const px = (value: number, size: number) => value * size;
  return <SketchReviewPanel>
    <Atom><Label>LLM 구조 스케치</Label><Copy>{iteration.plan.title} · 색상 펜으로 모델링 의도와 다른 부분을 표시한 뒤 피드백을 적용하거나 스케치를 승인하세요.</Copy></Atom>
    <SketchCanvas viewBox={`0 0 ${iteration.plan.width} ${iteration.plan.height}`} role="img" aria-label={`${iteration.plan.title} 주석 캔버스`} onPointerDown={begin} onPointerMove={draw} onPointerUp={end} onPointerCancel={end}>
      {iteration.plan.components.map((component) => <g key={component.id}>
        <rect x={px(component.x, iteration.plan.width)} y={px(component.y, iteration.plan.height)} width={px(component.width, iteration.plan.width)} height={px(component.height, iteration.plan.height)} rx={component.shape === "body" ? 24 : 10} fill={component.color} fillOpacity="0.18" stroke={component.color} strokeWidth="3" />
        <text x={px(component.x, iteration.plan.width)} y={px(component.y, iteration.plan.height) - 10} fill="currentColor" fontSize="18">{component.label}</text>
      </g>)}
      {iteration.plan.annotations.map((annotation, index) => <text key={`${annotation.label}-${index}`} x={px(annotation.x, iteration.plan.width)} y={px(annotation.y, iteration.plan.height)} fill="currentColor" fontSize="14">{annotation.label}</text>)}
      <SketchAnnotationLayer>{strokes.map((stroke) => <polyline key={stroke.id} points={stroke.points.map((item) => `${px(item.x, iteration.plan.width)},${px(item.y, iteration.plan.height)}`).join(" ")} fill="none" stroke={stroke.color} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />)}</SketchAnnotationLayer>
    </SketchCanvas>
    <PenToolbar>{PEN_COLORS.map((pen) => <ActionButton className={CLASS.modelingAction} data-active={color === pen.id} key={pen.id} onClick={() => setColor(pen.id)}>{pen.label}</ActionButton>)}<ActionButton className={CLASS.modelingAction} disabled={pending || iteration.status !== "proposed"} onClick={() => setStrokes([])}>전체 지우기</ActionButton><ActionButton className={CLASS.modelingAction} disabled={pending || iteration.status !== "proposed"} onClick={() => onSave(iteration, strokes)}>주석 저장</ActionButton></PenToolbar>
    <FormField label="이 단계의 추가 모델링 지시"><textarea className={joinClasses(CLASS.modelingControl, CLASS.modelingTextarea)} value={feedback} onChange={(event) => setFeedback(event.target.value)} placeholder="예: 뚜껑 리브를 더 촘촘히, 목 부분의 유리 링을 강조" /></FormField>
    <AssetNodeActions><ActionButton className={CLASS.modelingAction} disabled={pending || iteration.status !== "proposed"} onClick={() => onFeedback(iteration, feedback)}>피드백 적용</ActionButton><ActionButton className={CLASS.modelingAction} disabled={pending || iteration.status !== "proposed"} onClick={() => onApprove(iteration)}>이 단계 승인</ActionButton></AssetNodeActions>
    <IterationNavigator>{(draft.iterations ?? []).map((item) => <span key={item.id}>#{item.ordinal} · {item.status}</span>)}</IterationNavigator>
  </SketchReviewPanel>;
}

const THREE_D_LABEL_SHEETS = ["한글표시사항", "전체 가격 구조"] as const;

function useRenderedLabelTexture(
  rootRef: RefObject<HTMLDivElement | null>,
  sourceKey: string,
  expectedLabels: readonly [string, string],
): RenderedLabelTexture | undefined {
  const [captured, setCaptured] = useState<CapturedTexture>();

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    let disposed = false;
    let scheduledFrame = 0;
    let captureSequence = 0;

    const capture = async () => {
      const sequence = ++captureSequence;
      try {
        const texture = await renderLabelStickerToTexture(root, expectedLabels);
        if (disposed || sequence !== captureSequence) return;
        setCaptured((current) => {
          if (
            current?.sourceKey === sourceKey
            && current.texture.front.dataUrl === texture.front.dataUrl
            && current.texture.back.dataUrl === texture.back.dataUrl
          ) return current;
          return { sourceKey, texture };
        });
      } catch (error) {
        if (!disposed) console.error(`[NET30] SKU ${sourceKey} 라벨 캡처 실패`, error);
      }
    };

    const scheduleCapture = () => {
      cancelAnimationFrame(scheduledFrame);
      scheduledFrame = requestAnimationFrame(() => {
        void capture();
      });
    };

    const mutationObserver = new MutationObserver(scheduleCapture);
    mutationObserver.observe(root, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });

    const resizeObserver = new ResizeObserver(scheduleCapture);
    resizeObserver.observe(root);
    root.querySelectorAll<HTMLElement>(".ds-label-sticker-sheet").forEach((sheet) => resizeObserver.observe(sheet));

    window.addEventListener("resize", scheduleCapture);
    scheduleCapture();
    void document.fonts?.ready.then(() => {
      if (!disposed) scheduleCapture();
    });

    return () => {
      disposed = true;
      captureSequence += 1;
      cancelAnimationFrame(scheduledFrame);
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener("resize", scheduleCapture);
    };
  }, [expectedLabels, rootRef, sourceKey]);

  return captured?.sourceKey === sourceKey ? captured.texture : undefined;
}

const anchor = (id: string) => `#${id}`;

function HeroTextBlock({
  definition,
  as,
  className,
}: {
  definition: HeroTextDefinition;
  as: ElementType;
  className?: string;
}) {
  const rows = definition.lines.filter((row) => row.text.trim().length > 0);
  return <Atom as={as} className={className}>{rows.map((row, index) => <Fragment key={`${row.text}-${index}`}>
    {row.emphasis ? <Atom as={ELEMENT.emphasis}>{row.text}</Atom> : <Atom as={ELEMENT.span}>{row.text}</Atom>}
    {index < rows.length - 1 ? <Atom as={ELEMENT.break} /> : null}
  </Fragment>)}</Atom>;
}

function HeaderRegion({ definition, bagCount }: { definition: ProductPageDefinition; bagCount: number }) {
  const { brand, labels, navigation, system } = definition;
  const targets = {
    catalog: system.catalogId,
    trace: system.traceId,
    principles: system.principlesId,
  } as const;
  return <SiteHeader
    label={labels.primaryNavigation}
    brand={brand.name}
    brandHref={anchor(system.topId)}
    navigation={navigation.map((item) => ({ label: item.label, href: anchor(targets[item.target]) }))}
    bagHref={anchor(system.catalogId)}
    bagLabel={labels.bag}
    bagCount={bagCount}
    dot={labels.dot}
  />;
}

function HeroRegion({
  definition,
  activeRenderedLabel,
}: {
  definition: ProductPageDefinition;
  activeRenderedLabel: ActiveRenderedLabel | null;
}) {
  const { hero, system } = definition;
  return <Container as={ELEMENT.section} className={CLASS.hero} id={system.topId}>
    <Atom className={CLASS.heroCopy}>
      <Label><HeroTextBlock definition={hero.label} as={ELEMENT.span} /></Label>
      <HeroTextBlock definition={hero.heading} as={ELEMENT.heading1} />
      <Copy><HeroTextBlock definition={hero.copy} as={ELEMENT.span} /></Copy>
      <Link className={CLASS.heroLink} href={anchor(system.catalogId)}>
        <HeroTextBlock definition={hero.link} as={ELEMENT.span} />
      </Link>
    </Atom>
    <Surface className={CLASS.heroProduct}>
      <Atom className={CLASS.heroIndex}><Label>{hero.index}</Label><Atom as={ELEMENT.span}>{hero.range}</Atom></Atom>
      <Atom className={CLASS.heroTrio}>{definition.catalog.primaryOptions.map((item) => <ProductVisual
        compact
        visual={item.visual}
        labelPayload={activeRenderedLabel?.primaryId === item.id ? activeRenderedLabel.payload : undefined}
        modelAssetPath={activeRenderedLabel?.primaryId === item.id ? activeRenderedLabel.modelAssetPath : null}
        runtimeState={activeRenderedLabel?.primaryId === item.id ? activeRenderedLabel.runtimeState : "unassigned"}
        key={item.id}
      />)}</Atom>
      <Atom className={CLASS.heroFoot}><Atom as={ELEMENT.span}>{hero.left}</Atom><Atom as={ELEMENT.span}>{hero.right}</Atom></Atom>
    </Surface>
  </Container>;
}

function ProductCatalogRegion({
  definition,
  onRenderedLabel,
}: {
  definition: ProductPageDefinition;
  onRenderedLabel: (value: ActiveRenderedLabel | null) => void;
}) {
  const [primaryIndex, setPrimaryIndex] = useState(0);
  const [secondaryIndex, setSecondaryIndex] = useState(Math.min(1, definition.catalog.secondaryOptions.length - 1));
  const labelRootRef = useRef<HTMLDivElement>(null);
  const { catalog, catalogSection, labels, system } = definition;
  const { primary, secondary, factory, factoryIndex, sku } = selectCombination(catalog, primaryIndex, secondaryIndex);
  const renderedLabel = useRenderedLabelTexture(labelRootRef, sku.id, THREE_D_LABEL_SHEETS);
  const labelPayload = useMemo<ThreeDLabelPayload | undefined>(
    () => renderedLabel ? { skuId: sku.id, renderedLabel } : undefined,
    [renderedLabel, sku.id],
  );
  const [runtimeModel, setRuntimeModel] = useState<{ assetPath: string | null; state: "unassigned" | "empty" | "ready" } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setRuntimeModel(null);
    void fetch(`/api/modeling/runtime/skus/${encodeURIComponent(sku.id)}/model`, { signal: controller.signal }).then(async (response) => {
      const body = await response.json() as { ok?: boolean; assetPath?: string | null; state?: "unassigned" | "empty" | "ready" };
      if (response.ok && body.ok && body.state) setRuntimeModel({ assetPath: body.assetPath ?? null, state: body.state });
      else setRuntimeModel({ assetPath: null, state: "unassigned" });
    }).catch(() => { if (!controller.signal.aborted) setRuntimeModel({ assetPath: null, state: "unassigned" }); });
    return () => controller.abort();
  }, [sku.id]);

  useEffect(() => {
    onRenderedLabel({ primaryId: primary.id, payload: labelPayload, modelAssetPath: runtimeModel?.assetPath ?? null, runtimeState: runtimeModel?.state ?? "loading" });
  }, [labelPayload, onRenderedLabel, primary.id, runtimeModel]);

  useEffect(() => () => onRenderedLabel(null), [onRenderedLabel]);

  const total = secondary.price + primary.surcharge;
  const stickerTotal = sku.label.ingredients.reduce((sum, item) => sum + item.cost, 0)
    + sku.label.costs.reduce((sum, item) => sum + item.amount, 0);
  if (catalog.presentation === "label" && (stickerTotal !== sku.label.consumerPrice || total !== sku.label.consumerPrice)) {
    throw new Error(`SKU ${sku.id} price receipt does not reconcile`);
  }

  const vat = Math.round(total - total / catalog.economics.vatRate);
  const platform = Math.round(total * catalog.economics.platformRate);
  const contribution = total - vat - platform - secondary.landedCost;
  const economics = [
    { name: labels.vat, value: vat },
    { name: labels.platform, value: platform },
    { name: labels.landed, value: secondary.landedCost },
    { name: labels.contribution, value: contribution },
  ];
  const globeStops = useMemo(
    () => catalog.routes.map(({ id, city, location }) => ({ id, city, location })),
    [catalog.routes],
  );
  const globeArcs = useMemo(
    () => catalog.arcs.map((arc) => ({
      id: arc.id,
      from: catalog.routes[arc.from].location,
      to: catalog.routes[arc.to].location,
      cost: arc.cost,
    })),
    [catalog.arcs, catalog.routes],
  );
  const routePanel = <Panel className={CLASS.globeCard}>
    <PanelHeader><Label>{labels.supplyRoute}</Label></PanelHeader>
    <PanelBody><SupplyGlobe stops={globeStops} arcs={globeArcs} active={factoryIndex} ariaLabel={labels.routeAria} nodeLabel={labels.routeNode} /></PanelBody>
    <PanelFooter>
      <Atom as={ELEMENT.span}>{factory.city}{labels.dot}{factory.country}{labels.dot}{factory.role}</Atom>
      <Atom as={ELEMENT.span}>{labels.routeHint}</Atom>
    </PanelFooter>
  </Panel>;
  const economicsPanel = <Panel className={CLASS.costBreakdown}>
    <PanelHeader className={CLASS.costTitle}><Label>{labels.economics}</Label></PanelHeader>
    <PanelBody><SurfaceGrid className={CLASS.costItems}>{economics.map((item) => <GridCell className={CLASS.costItem} key={item.name}>
      <Label>{item.name}</Label>
      <Atom as={ELEMENT.progress}><Atom as={ELEMENT.progressFill} style={{ width: `${Math.max(0, item.value / total * catalog.economics.percentageScale)}${labels.percent}` }} /></Atom>
      <Atom as={ELEMENT.strong}>{labels.currencyMark}{item.value.toLocaleString(system.locale)}</Atom>
      <Atom as={ELEMENT.span}>{Math.round(item.value / total * catalog.economics.percentageScale)}{labels.percent}</Atom>
    </GridCell>)}</SurfaceGrid></PanelBody>
    <PanelFooter className={CLASS.costFooter}>{labels.economicsNote}<Atom as={ELEMENT.span}>{labels.contributionSuffix}{labels.dot}{labels.distance}</Atom></PanelFooter>
  </Panel>;
  const detailRegistry = { route: routePanel, economics: economicsPanel } as const;
  const metricsView = <Atom className={CLASS.productGrid}>
    <SurfaceGrid className={CLASS.metrics}>{catalog.metrics.map((metric) => <Metric key={metric.key} label={metric.label} value={secondary.values[metric.key]} suffix={metric.suffix} />)}</SurfaceGrid>
    <Surface className={CLASS.density}>
      <Metric label={labels.score} value={secondary.score} suffix={labels.scoreSuffix} />
      <Atom className={CLASS.densityLine}><Atom as={ELEMENT.progress} style={{ width: `${secondary.score}${labels.percent}` }} /></Atom>
      <Copy>{labels.scoreNote}</Copy>
    </Surface>
  </Atom>;
  const labelView = <KoreanSupplementLabel
    rootRef={labelRootRef}
    definition={sku.label}
    locale={system.locale}
    currencyMark={labels.currencyMark}
    percentMark={labels.percent}
  />;

  return <Container as={ELEMENT.section} className={CLASS.section} id={system.catalogId}>
    <SectionHeading {...catalogSection} />
    <Atom className={CLASS.designShowcase} role={ROLE.tablist} aria-label={labels.primaryChoice}>
      {catalog.primaryOptions.map((item, index) => <LabeledChoice
        className={CLASS.designCard}
        code={item.code}
        name={item.name}
        detail={item.detail}
        selected={primaryIndex === index}
        onClick={() => setPrimaryIndex(index)}
        visual={<ProductVisual
          compact
          visual={item.visual}
          labelPayload={primaryIndex === index ? labelPayload : undefined}
          modelAssetPath={primaryIndex === index ? runtimeModel?.assetPath ?? null : null}
          runtimeState={primaryIndex === index ? runtimeModel?.state ?? "loading" : "unassigned"}
        />}
        key={item.id}
      />)}
    </Atom>
    <Atom className={CLASS.qualityPrices} role={ROLE.tablist} aria-label={labels.secondaryChoice}>
      {catalog.secondaryOptions.map((item, index) => <LabeledChoice
        className={CLASS.qualityPrice}
        code={item.code}
        name={item.name}
        detail={`${(item.price + primary.surcharge).toLocaleString(system.locale)}${labels.currency}${labels.dot}${item.role}`}
        selected={secondaryIndex === index}
        onClick={() => setSecondaryIndex(index)}
        key={item.id}
      />)}
    </Atom>
    {catalog.presentation === "label" ? labelView : metricsView}
    <Atom className={CLASS.trace} id={system.traceId}>
      <Atom className={CLASS.traceGrid}>{catalog.detailPanels.map((panel) => <Fragment key={panel}>{detailRegistry[panel]}</Fragment>)}</Atom>
    </Atom>
  </Container>;
}


function ModelingCatalogRegion({ definition }: { definition: ProductPageDefinition }) {
  const { catalog, system } = definition;
  const studio = catalog.modeling;
  if (!studio) throw new Error("Modeling presentation requires catalog.modeling");

  const defaults = studio.defaults;
  const [components, setComponents] = useState<readonly string[]>(defaults.componentIds);
  const [componentInput, setComponentInput] = useState(defaults.componentIds.map((id) => studio.components.find((component) => component.id === id)?.label ?? id).join(", "));
  const [componentPrompts, setComponentPrompts] = useState<Record<string, string>>({});
  const [model, setModel] = useState(defaults.modelId);
  const [models, setModels] = useState<readonly { id: string; label: string }[]>([]);
  const [images, setImages] = useState<File[]>([]);
  const [material, setMaterial] = useState(defaults.materialId);
  const [shape, setShape] = useState(defaults.shapeId);
  const [productModels, setProductModels] = useState<readonly ProductModel[]>([]);
  const [activeParentModelId, setActiveParentModelId] = useState<string | null>(null);
  const [activeParentTree, setActiveParentTree] = useState<ProductModelTree | null>(null);
  const [archivedParents, setArchivedParents] = useState<readonly ProductModel[]>([]);
  const [editTarget, setEditTarget] = useState<AssetEditTarget | null>(null);
  const [editingName, setEditingName] = useState<{ id: string; value: string; revision: number } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProductModel | null>(null);
  const [assetActionPending, setAssetActionPending] = useState<string | null>(null);
  const [modelListError, setModelListError] = useState("");
  const [bindingPendingId, setBindingPendingId] = useState<string | null>(null);
  const [sizeXmm, setSizeXmm] = useState(defaults.sizeXmm);
  const [sizeYmm, setSizeYmm] = useState(defaults.sizeYmm);
  const [sizeZmm, setSizeZmm] = useState(defaults.sizeZmm);
  const [shellThicknessMm, setShellThicknessMm] = useState(defaults.shellThicknessMm);
  const [distortion, setDistortion] = useState(defaults.distortion);
  const [tone, setTone] = useState(defaults.tone);
  const [finish, setFinish] = useState(defaults.finish);
  const [prompt, setPrompt] = useState(defaults.prompt);
  const [productName, setProductName] = useState(studio.workspace.productName);
  const [draft, setDraft] = useState<ModelingDraft | null>(null);
  const [activeReviewScope, setActiveReviewScope] = useState("assembly");
  const [draftDecisionPending, setDraftDecisionPending] = useState(false);
  const [buildInProgress, setBuildInProgress] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [previewRevision, setPreviewRevision] = useState("initial");
  const [previewModel, setPreviewModel] = useState("");
  const [progress, setProgress] = useState("");
  const [downloadReady, setDownloadReady] = useState(false);
  const [componentProgress, setComponentProgress] = useState<Record<string, { state: string; message: string; version?: string | null }>>({});
  const [resultArtifacts, setResultArtifacts] = useState<{ assemblyGlb?: string; report?: string; components?: Record<string, string | null> }>({});
  const [versions, setVersions] = useState<Record<string, readonly ModelingLibraryVersion[]>>({});
  const [parentVersionId, setParentVersionId] = useState<Record<string, string>>({});
  const [includedNodePaths, setIncludedNodePaths] = useState<readonly string[]>([]);
  const [focusedAsset, setFocusedAsset] = useState<FocusedAsset>(null);
  const [libraryPreviewModel, setLibraryPreviewModel] = useState("");
  const [libraryPreviewRevision, setLibraryPreviewRevision] = useState("initial");
  const [libraryPreviewPending, setLibraryPreviewPending] = useState(false);
  const [libraryError, setLibraryError] = useState("");
  const libraryPreviewRequest = useRef(0);
  const parentTreeRequest = useRef(0);
  const modelEndpoint = studio.endpoint.replace(/\/jobs$/, "/models");
  const skuOptions = useMemo(() => catalog.skus.map((sku) => ({ id: sku.id, label: ({ "all-in-one-pilot": "30일분 · 일반가", "all-in-one-growth": "30일분 · 회원가", "all-in-one-scale": "30일분 · 정기구독가" }[sku.id] ?? sku.id) + ` (${sku.id})` })), [catalog.skus]);

  const previewJoin = studio.previewSrc.includes("?") ? "&" : "?";
  const modelPreviewSrc = (assetPath: string, revision: string) => `${studio.previewSrc}${previewJoin}refresh=${revision}&model=${encodeURIComponent(assetPath)}`;
  const previewSrc = previewModel ? modelPreviewSrc(previewModel, previewRevision) : "";
  const libraryPreviewSrc = libraryPreviewModel ? modelPreviewSrc(libraryPreviewModel, libraryPreviewRevision) : "";

  useEffect(() => {
    const controller = new AbortController();
    const schemaEndpoint = studio.endpoint.replace(/\/jobs$/, "/schema");
    void fetch(schemaEndpoint, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) return;
      const body = await response.json() as { models?: string[]; defaultModel?: string };
      const choices = (body.models ?? []).map((id) => ({ id, label: id }));
      setModels(choices);
      setModel((current) => current || body.defaultModel || choices[0]?.id || "");
    }).catch(() => undefined);
    return () => controller.abort();
  }, [studio.endpoint]);

  const refreshProductModels = useCallback(async () => {
    const response = await fetch(`${modelEndpoint}?scope=product`);
    const body = await response.json() as { ok?: boolean; models?: readonly ProductModel[]; error?: string };
    if (!response.ok || !body.ok) throw new Error(body.error ?? "제품 모델 목록을 불러오지 못했습니다.");
    setProductModels(body.models ?? []);
    setActiveParentModelId((current) => current && (body.models ?? []).some((item) => item.id === current) ? current : null);
    const archivedResponse = await fetch(`${modelEndpoint}?scope=product&includeArchived=true`);
    const archivedBody = await archivedResponse.json() as { ok?: boolean; models?: readonly ProductModel[] };
    if (archivedResponse.ok && archivedBody.ok) setArchivedParents((archivedBody.models ?? []).filter((item) => item.status === "archived"));
  }, [modelEndpoint]);

  useEffect(() => { void refreshProductModels().catch((requestError) => setModelListError(requestError instanceof Error ? requestError.message : String(requestError))); }, [refreshProductModels]);

  const refreshParentTree = useCallback(async (parentId: string, revisionId?: string) => {
    const requestId = ++parentTreeRequest.current;
    setActiveParentTree(null);
    const suffix = revisionId ? `?revisionId=${encodeURIComponent(revisionId)}` : "";
    const response = await fetch(`${modelEndpoint}/${parentId}/tree${suffix}`);
    const body = await response.json() as { ok?: boolean; model?: ProductModelTree; error?: string };
    if (!response.ok || !body.ok || !body.model) throw new Error(body.error ?? "부모 모델의 하위 자산을 불러오지 못했습니다.");
    if (requestId !== parentTreeRequest.current) return null;
    setActiveParentTree(body.model);
    setIncludedNodePaths(body.model.children.map((child) => child.path || child.id));
    return body.model;
  }, [modelEndpoint]);

  useEffect(() => {
    if (!activeParentModelId) { setActiveParentTree(null); setIncludedNodePaths([]); return; }
    void refreshParentTree(activeParentModelId).catch((requestError) => setLibraryError(requestError instanceof Error ? requestError.message : String(requestError)));
  }, [activeParentModelId, refreshParentTree]);

  useEffect(() => {
    if (!draft?.id || ["complete", "review_required", "failed", "analysis_incomplete", "needs_custom_recipe"].includes(draft.state)) return;
    const draftUrl = `${studio.endpoint.replace(/\/jobs$/, "/drafts")}/${draft.id}`;
    const events = new EventSource(`${draftUrl}/events`);
    const refresh = async () => {
      try {
        const response = await fetch(draftUrl); const body = await response.json() as { ok?: boolean; draft?: ModelingDraft };
        if (response.ok && body.ok && body.draft) { setDraft(body.draft); setProgress(body.draft.message); }
      } catch { /* SSE reconnects; the bounded poll is the offline fallback. */ }
    };
    events.onmessage = (event) => {
      try { const update = JSON.parse(event.data) as { message?: string; progress?: ModelingProgress }; if (update.message) setProgress(update.message); } catch { /* ignore malformed event */ }
      void refresh();
    };
    const fallback = window.setInterval(() => void refresh(), 4000);
    return () => { events.close(); window.clearInterval(fallback); };
  }, [draft?.id, studio.endpoint]);

  const refreshVersions = async (componentIds: readonly string[]) => {
    const entries = await Promise.all(componentIds.map(async (component) => {
      const response = await fetch(`${studio.endpoint.replace(/\/jobs$/, "")}/components/${component}/versions`);
      const body = await response.json() as { ok?: boolean; versions?: readonly { id: string; ordinal: number; summary: string; createdAt: string; assetPath: string }[] };
      if (!response.ok || !body.ok) throw new Error(`${component} 버전을 불러오지 못했습니다.`);
      return [component, body.versions ?? []] as const;
    }));
    setVersions((current) => mergeComponentVersions(current, Object.fromEntries(entries)));
  };

  useEffect(() => {
    void refreshVersions(studio.components.map((component) => component.id)).catch((requestError) => {
      setLibraryError(requestError instanceof Error ? requestError.message : String(requestError));
    });
  }, [studio.endpoint]);

  useEffect(() => {
    if (!activeParentTree || !includedNodePaths.length) { libraryPreviewRequest.current += 1; setLibraryPreviewModel(""); setLibraryPreviewPending(false); return; }
    const timer = window.setTimeout(() => { void requestTreePreview(); }, 300);
    return () => { window.clearTimeout(timer); libraryPreviewRequest.current += 1; };
  }, [activeParentTree, includedNodePaths]);


  const bindSku = async (productModel: ProductModel, skuId: string | null) => {
    setBindingPendingId(productModel.id); setModelListError("");
    try {
      const response = await fetch(`${modelEndpoint}/${productModel.id}/sku`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ skuId, expectedRevision: productModel.revision }) });
      const body = await response.json() as { ok?: boolean; error?: string; model?: ProductModel };
      if (!response.ok || !body.ok || !body.model) throw new Error(body.error ?? "SKU 연결을 저장하지 못했습니다.");
      setProductModels((current) => current.map((item) => item.id === body.model?.id ? body.model : item));
      setProgress(`${body.model.name}과 SKU 연결을 저장했습니다.`);
    } catch (requestError) { setModelListError(requestError instanceof Error ? requestError.message : String(requestError)); await refreshProductModels().catch(() => undefined); }
    finally { setBindingPendingId(null); }
  };

  const saveModelName = async () => {
    if (!editingName) return;
    setAssetActionPending(editingName.id); setLibraryError("");
    try {
      const response = await fetch(`${modelEndpoint}/${editingName.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: editingName.value, expectedRevision: editingName.revision }) });
      const body = await response.json() as { ok?: boolean; model?: ProductModel; error?: string };
      if (!response.ok || !body.ok || !body.model) throw new Error(body.error ?? "모델 이름을 저장하지 못했습니다.");
      setEditingName(null); await refreshProductModels(); if (activeParentModelId) await refreshParentTree(activeParentModelId);
    } catch (requestError) { setLibraryError(requestError instanceof Error ? requestError.message : String(requestError)); }
    finally { setAssetActionPending(null); }
  };

  const archiveParent = async () => {
    if (!deleteTarget) return;
    setAssetActionPending(deleteTarget.id); setLibraryError("");
    try {
      const response = await fetch(`${modelEndpoint}/${deleteTarget.id}`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedRevision: deleteTarget.revision }) });
      const body = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !body.ok) throw new Error(body.error ?? "부모 모델을 삭제하지 못했습니다.");
      setDeleteTarget(null); setEditTarget(null); setDraft(null); setPreviewModel(""); await refreshProductModels();
    } catch (requestError) { setLibraryError(requestError instanceof Error ? requestError.message : String(requestError)); }
    finally { setAssetActionPending(null); }
  };

  const restoreParent = async (item: ProductModel) => {
    setAssetActionPending(item.id); setLibraryError("");
    try {
      const response = await fetch(`${modelEndpoint}/${item.id}/restore`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedRevision: item.revision }) });
      const body = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !body.ok) throw new Error(body.error ?? "부모 모델을 복원하지 못했습니다.");
      await refreshProductModels(); setActiveParentModelId(item.id);
    } catch (requestError) { setLibraryError(requestError instanceof Error ? requestError.message : String(requestError)); }
    finally { setAssetActionPending(null); }
  };

  const beginAssetRefine = (tree: ProductModelTree, child?: ProductModelTree["children"][number]) => {
    const rootRevision = activeParentTree?.selectedRevision.id ?? tree.selectedRevision.id;
    if (child) {
      setProductName(tree.name); setComponentInput(child.model.name); setEditTarget({ mode: "refine-node", rootModelId: tree.id, baseRootRevisionId: rootRevision, targetModelId: child.model.id, baseTargetRevisionId: child.model.selectedRevision.id, targetChildRefIds: [child.id], label: `${child.model.name} + OpenAI × Blender` });
    } else {
      if (!tree.children.length) { beginAddChild(tree); return; }
      setProductName(tree.name); setComponentInput(tree.children.map((item) => item.model.name).join(", ")); setEditTarget({ mode: "refine-assembly", rootModelId: tree.id, baseRootRevisionId: rootRevision, targetChildRefIds: tree.children.map((item) => item.id), label: `${tree.name} + OpenAI × Blender` });
    }
    setDraft(null); setPreviewModel(""); setError(""); setProgress("선택 자산을 기준으로 OpenAI × Blender 보완을 준비했습니다.");
  };

  const beginAddChild = (tree: ProductModelTree) => {
    setProductName(tree.name); setComponentInput("새 하위 자산"); setEditTarget({ mode: "add-child", rootModelId: tree.id, baseRootRevisionId: activeParentTree?.selectedRevision.id ?? tree.selectedRevision.id, label: `${tree.name} + OpenAI × Blender · 하위 자산 추가` }); setDraft(null); setPreviewModel("");
  };

  const removeChildAsset = async (tree: ProductModelTree, childRefId: string) => {
    setAssetActionPending(childRefId); setLibraryError("");
    try {
      const response = await fetch(`${modelEndpoint}/${tree.id}/children/${childRefId}`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedRevision: tree.revision, baseRevisionId: tree.selectedRevision.id }) });
      const body = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !body.ok) throw new Error(body.error ?? "하위 자산을 현재 조립에서 제거하지 못했습니다.");
      setIncludedNodePaths((current) => current.filter((path) => path !== childRefId && !path.startsWith(`${childRefId}/`))); await refreshProductModels(); await refreshParentTree(tree.id);
    } catch (requestError) { setLibraryError(requestError instanceof Error ? requestError.message : String(requestError)); }
    finally { setAssetActionPending(null); }
  };

  const requestTreePreview = async () => {
    if (!activeParentTree) return;
    const requestId = ++libraryPreviewRequest.current;
    const selectedNodePaths = [...includedNodePaths];
    if (!selectedNodePaths.length) { setLibraryPreviewModel(""); setLibraryError("조립 미리보기에 포함할 하위 자산을 선택하세요."); return; }
    setLibraryPreviewPending(true); setLibraryError("");
    try {
      const response = await fetch(`${modelEndpoint}/${activeParentTree.id}/assemblies/preview`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ baseRevisionId: activeParentTree.selectedRevision.id, selectedNodePaths }) });
      const body = await response.json() as { ok?: boolean; error?: string; assembly?: { assetPath?: string } };
      if (!response.ok || !body.ok || !body.assembly?.assetPath) throw new Error(body.error ?? "선택한 하위 자산을 조립하지 못했습니다.");
      if (requestId !== libraryPreviewRequest.current) return;
      setLibraryPreviewModel(body.assembly.assetPath); setLibraryPreviewRevision(Date.now().toString());
    } catch (requestError) { if (requestId === libraryPreviewRequest.current) setLibraryError(requestError instanceof Error ? requestError.message : String(requestError)); }
    finally { if (requestId === libraryPreviewRequest.current) setLibraryPreviewPending(false); }
  };

  const publishSelectedChildren = async () => {
    if (!activeParentTree) return; const parent = productModels.find((item) => item.id === activeParentTree.id); const selectedNodePaths = [...includedNodePaths];
    if (!parent?.linkedSkuId) { setLibraryError("홈에 표시하려면 선택한 부모 모델에 SKU를 먼저 연결하세요."); return; }
    if (!selectedNodePaths.length) { setLibraryError("홈에 게시할 하위 자산을 선택하세요."); return; }
    setLibraryPreviewPending(true); setLibraryError("");
    try {
      const saved = await fetch(`${modelEndpoint}/${parent.id}/revisions/library`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedRevision: parent.revision, baseRevisionId: activeParentTree.selectedRevision.id, selectedNodePaths }) }); const savedBody = await saved.json() as { ok?: boolean; error?: string; model?: ProductModel; revision?: { id: string } };
      if (!saved.ok || !savedBody.ok || !savedBody.model || !savedBody.revision) throw new Error(savedBody.error ?? "선택한 조립 리비전을 저장하지 못했습니다.");
      const published = await fetch(`${modelEndpoint}/${parent.id}/revisions/${savedBody.revision.id}/publish`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedRevision: savedBody.model.revision }) }); const publishedBody = await published.json() as { ok?: boolean; error?: string; publication?: { assetPath?: string } };
      if (!published.ok || !publishedBody.ok || !publishedBody.publication?.assetPath) throw new Error(publishedBody.error ?? "선택한 조립을 홈에 게시하지 못했습니다.");
      setLibraryPreviewModel(publishedBody.publication.assetPath); setLibraryPreviewRevision(Date.now().toString()); await refreshProductModels(); await refreshParentTree(parent.id);
    } catch (requestError) { setLibraryError(requestError instanceof Error ? requestError.message : String(requestError)); }
    finally { setLibraryPreviewPending(false); }
  };

  const uploadImages = async () => {
    if (images.length > 4) throw new Error("모델링 입력 이미지는 최대 4장입니다.");
    const ids: string[] = [];
    for (const file of images) {
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("JPEG, PNG, WebP 이미지만 첨부할 수 있습니다.");
      if (file.size > 10 * 1024 * 1024) throw new Error("이미지는 파일당 10MB 이하여야 합니다.");
      const create = await fetch(studio.endpoint.replace(/\/jobs$/, "/uploads"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ filename: file.name, contentType: file.type, size: file.size }) });
      const created = await create.json() as { ok?: boolean; error?: string; upload?: { id: string; uploadUrl: string; direct: boolean } };
      if (!create.ok || !created.ok || !created.upload) throw new Error(created.error ?? "이미지 업로드 준비에 실패했습니다.");
      const sent = await fetch(created.upload.uploadUrl, { method: "PUT", headers: { "content-type": file.type }, body: file });
      if (!sent.ok) throw new Error("이미지 업로드에 실패했습니다.");
      if (created.upload.direct) {
        const complete = await fetch(`${studio.endpoint.replace(/\/jobs$/, "/uploads")}/${created.upload.id}/complete`, { method: "POST" });
        if (!complete.ok) throw new Error("이미지 업로드 완료 확인에 실패했습니다.");
      }
      ids.push(created.upload.id);
    }
    return ids;
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const requestedComponents = componentInput.normalize("NFKC").split(",").map((item) => item.trim()).filter(Boolean);
    if (!requestedComponents.length || requestedComponents.length > 30 || requestedComponents.some((name) => Array.from(name).length > 60) || new Set(requestedComponents).size !== requestedComponents.length) {
      setError("컴포넌트는 쉼표로 구분한 1~30개의 고유한 이름(각 60자 이하)이어야 합니다."); return;
    }
    setPending(true);
    setDraft(null);
    setPreviewModel("");
    setPreviewRevision("initial");
    setBuildInProgress(false);
    setResult("");
    setError("");
    setResultArtifacts({});
    setDownloadReady(false);
    setComponentProgress({});
    setProgress(images.length ? "이미지 업로드 중" : "제품 분석 지시 준비 중");
    try {
      const imageIds = await uploadImages();
      setProgress("OpenAI가 제품과 구성 부품을 분석 중");
      const operation = !editTarget ? "create-parent" : editTarget.mode === "refine-assembly" ? "refine-parent" : editTarget.mode === "refine-node" ? "refine-child" : "add-child";
      const response = await fetch(studio.endpoint.replace(/\/jobs$/, "/drafts"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          version: "net30.modeling-draft.v7", operation, model: model || undefined, imageIds, prompt, componentInput,
          target: editTarget ? { rootModelId: editTarget.rootModelId, baseRootRevisionId: editTarget.baseRootRevisionId, mode: editTarget.mode, targetModelId: editTarget.targetModelId, baseTargetRevisionId: editTarget.baseTargetRevisionId, targetChildRefIds: editTarget.targetChildRefIds ?? [] } : undefined,
          expectedRootRevision: editTarget ? productModels.find((item) => item.id === editTarget.rootModelId)?.revision : undefined,
          revisionBaseRefs: Object.fromEntries(Object.entries(parentVersionId).map(([component, versionId]) => [component, { versionId }])),
          assemblyAssetRefs: [],
          product: editTarget ? { source: "existing", productId: editTarget.rootModelId } : { source: "new", name: productName },
        }),
      });
      const body = await response.json() as { ok?: boolean; error?: string; draft?: ModelingDraft; parentModel?: ProductModel; statusUrl?: string };
      if (!response.ok || !body.ok || !body.draft) throw new Error(body.error ?? `초안 요청 실패 (${response.status})`);
      setDraft(body.draft); if (body.parentModel?.id) setActiveParentModelId(body.parentModel.id); setActiveReviewScope("assembly"); setProgress(body.draft.message); void refreshProductModels();
      const statusUrl = body.statusUrl ?? `${studio.endpoint.replace(/\/jobs$/, "/drafts")}/${body.draft.id}`;
      for (;;) {
        await new Promise((resolve) => window.setTimeout(resolve, 1200));
        const statusResponse = await fetch(statusUrl); const statusBody = await statusResponse.json() as { ok?: boolean; draft?: ModelingDraft; error?: string };
        if (!statusResponse.ok || !statusBody.ok || !statusBody.draft) throw new Error(statusBody.error ?? "초안 상태를 불러오지 못했습니다.");
        setDraft(statusBody.draft); setProgress(statusBody.draft.message);
        if (["awaiting_product_review", "awaiting_component_review", "awaiting_parameter_review", "ready_to_build", "failed", "analysis_incomplete", "needs_custom_recipe"].includes(statusBody.draft.state)) { if (["failed", "analysis_incomplete", "needs_custom_recipe"].includes(statusBody.draft.state)) throw new Error(statusBody.draft.message); break; }
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setPending(false);
    }
  };

  const decideDraftQuestion = async (question: ModelingDraftQuestion, action: "accept" | "override" | "reject" | "needs_evidence", overrideValue?: unknown) => {
    if (!draft) return;
    const value = action === "override" ? overrideValue : undefined;
    setDraftDecisionPending(true); setError("");
    try {
      const response = await fetch(`${studio.endpoint.replace(/\/jobs$/, "/drafts")}/${draft.id}/answers`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedRevision: draft.revision, decisions: [{ questionId: question.id, action, value }] }) });
      const body = await response.json() as { ok?: boolean; error?: string; draft?: ModelingDraft };
      if (!response.ok || !body.ok || !body.draft) throw new Error(body.error ?? "결정을 저장하지 못했습니다.");
      setDraft(body.draft); setProgress(body.draft.message);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : String(requestError)); }
    finally { setDraftDecisionPending(false); }
  };
  const reviewScopes = useMemo(() => draft ? [{ id: "assembly", label: "제품·조립" }, ...draft.components.map((component) => ({ id: component.id, label: component.displayName })), { id: "graphics", label: "고정 HTML 그래픽" }] : [], [draft]);
  const activeScopeQuestions = useMemo(() => {
    if (!draft) return [];
    if (activeReviewScope === "assembly") return draft.questions.filter((question) => ["product", "assembly", "interface"].includes(question.scope));
    if (activeReviewScope === "graphics") return draft.questions.filter((question) => question.scope === "sticker-slot");
    return draft.questions.filter((question) => question.scope === "component" && question.componentInstanceId === activeReviewScope);
  }, [activeReviewScope, draft]);
  const activeScopeLinkedQuestions = useMemo(() => !draft || ["assembly", "graphics"].includes(activeReviewScope) ? [] : draft.questions.filter((question) => ["assembly", "interface"].includes(question.scope) && question.appliesToComponentIds?.includes(activeReviewScope)), [activeReviewScope, draft]);
  const approveCurrentScope = async () => {
    if (!draft) return;
    const proposed = activeScopeQuestions.filter((question) => question.status === "proposed");
    if (!proposed.length) return;
    setDraftDecisionPending(true); setError("");
    try {
      const response = await fetch(`${studio.endpoint.replace(/\/jobs$/, "/drafts")}/${draft.id}/answers`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedRevision: draft.revision, decisions: proposed.map((question) => ({ questionId: question.id, action: "accept" })) }) });
      const body = await response.json() as { ok?: boolean; error?: string; draft?: ModelingDraft };
      if (!response.ok || !body.ok || !body.draft) throw new Error(body.error ?? "현재 범위의 승인을 저장하지 못했습니다.");
      setDraft(body.draft); setProgress(body.draft.message);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : String(requestError)); }
    finally { setDraftDecisionPending(false); }
  };
  const saveSketchMarkup = async (iteration: SketchIteration, strokes: readonly SketchStroke[]) => {
    if (!draft) return; setDraftDecisionPending(true); setError("");
    try { const response = await fetch(`${studio.endpoint.replace(/\/jobs$/, "/drafts")}/${draft.id}/iterations/${iteration.id}/markup`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedRevision: draft.revision, strokes }) }); const body = await response.json() as { ok?: boolean; error?: string; draft?: ModelingDraft }; if (!response.ok || !body.ok || !body.draft) throw new Error(body.error ?? "스케치 주석을 저장하지 못했습니다."); setDraft(body.draft); setProgress(body.draft.message); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : String(requestError)); }
    finally { setDraftDecisionPending(false); }
  };
  const applySketchFeedback = async (iteration: SketchIteration, feedbackPrompt: string) => {
    if (!draft) return; setDraftDecisionPending(true); setError("");
    try { const response = await fetch(`${studio.endpoint.replace(/\/jobs$/, "/drafts")}/${draft.id}/iterations/${iteration.id}/feedback`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedRevision: draft.revision, feedbackPrompt }) }); const body = await response.json() as { ok?: boolean; error?: string; draft?: ModelingDraft }; if (!response.ok || !body.ok || !body.draft) throw new Error(body.error ?? "스케치 피드백을 적용하지 못했습니다."); setDraft(body.draft); setProgress(body.draft.message); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : String(requestError)); }
    finally { setDraftDecisionPending(false); }
  };
  const approveSketch = async (iteration: SketchIteration) => {
    if (!draft) return; setDraftDecisionPending(true); setError("");
    try { const response = await fetch(`${studio.endpoint.replace(/\/jobs$/, "/drafts")}/${draft.id}/iterations/${iteration.id}/approve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedRevision: draft.revision }) }); const body = await response.json() as { ok?: boolean; error?: string; draft?: ModelingDraft }; if (!response.ok || !body.ok || !body.draft) throw new Error(body.error ?? "스케치를 승인하지 못했습니다."); setDraft(body.draft); setProgress(body.draft.message); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : String(requestError)); }
    finally { setDraftDecisionPending(false); }
  };
  const buildDraft = async () => {
    if (!draft?.approval?.ready) return;
    setPending(true); setBuildInProgress(true); setError("");
    try {
      const response = await fetch(`${studio.endpoint.replace(/\/jobs$/, "/drafts")}/${draft.id}/build`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedRevision: draft.revision, approvalHash: draft.approval.approvalHash }) });
      const body = await response.json() as { ok?: boolean; error?: string; job?: { id: string; message: string }; statusUrl?: string };
      if (!response.ok || !body.ok || !body.job) throw new Error(body.error ?? "Blender 작업을 시작하지 못했습니다.");
      setProgress(body.job.message ?? "승인된 Blender 작업을 시작했습니다.");
      const statusUrl = body.statusUrl ?? `${studio.endpoint}/${body.job.id}`;
      for (;;) { await new Promise((resolve) => window.setTimeout(resolve, 1200)); const responseStatus = await fetch(statusUrl); const current = await responseStatus.json() as { ok?: boolean; job?: { state: string; message: string; components?: Record<string, { state: string; message: string; version?: string | null }>; result?: { artifact?: { assemblyGlb?: string; report?: string }; versions?: Record<string, { component?: string }>; productModel?: { model?: ProductModel } } }; error?: string }; if (!responseStatus.ok || !current.ok || !current.job) throw new Error(current.error ?? "작업 상태를 불러오지 못했습니다."); setProgress(current.job.message); setComponentProgress(current.job.components ?? {}); if (["complete", "review_required", "failed"].includes(current.job.state)) { if (current.job.state === "failed") throw new Error(current.job.message); const artifact=current.job.result?.artifact; setPreviewModel(artifact?.assemblyGlb ?? ""); setPreviewRevision(Date.now().toString()); setResultArtifacts(artifact ?? {}); setDownloadReady(Boolean(artifact?.assemblyGlb)); setResult(current.job.message); setActiveParentModelId(current.job.result?.productModel?.model?.id ?? activeParentModelId); await Promise.all([refreshVersions(Object.keys(current.job.result?.versions ?? {})), refreshProductModels()]); break; } }
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : String(requestError)); }
    finally { setPending(false); setBuildInProgress(false); }
  };

  const selectField = (label: string, value: string, onChange: (value: string) => void, options: readonly { id: string; label: string }[]) => <FormField label={label} className={CLASS.modelingField}>
    <select className={CLASS.modelingControl} value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => <option value={option.id} key={option.id}>{option.label}</option>)}
    </select>
  </FormField>;
  const numberField = (label: string, value: number, onChange: (value: number) => void, step = "1") => <FormField label={label} className={CLASS.modelingField}>
    <input className={CLASS.modelingControl} type="number" step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
  </FormField>;
  const analysisInProgress = pending && !buildInProgress && (!draft || draft.state.startsWith("analyzing"));
  const activeWorkflowIndex = draft ? workflowIndex(draft.state, Boolean(previewModel)) : 0;
  const flatAssetNodes = useMemo(() => activeParentTree ? flattenAssetTree(activeParentTree) : [], [activeParentTree]);
  const toggleIncludedNodePath = (path: string) => setIncludedNodePaths((current) => current.includes(path)
    ? current.filter((item) => item !== path && !item.startsWith(`${path}/`))
    : [...current.filter((item) => !path.startsWith(`${item}/`)), path]);
  const focusParent = (productModel: ProductModel) => {
    setFocusedAsset({ kind: "parent", parentId: productModel.id, revisionId: productModel.currentRevision?.id ?? "", assetPath: productModel.currentRevision?.assetPath ?? null });
    setLibraryPreviewModel(""); setPreviewModel(""); setActiveParentModelId(productModel.id);
  };
  const focusChild = (node: FlatAssetNode) => {
    if (!activeParentTree) return;
    setFocusedAsset({ kind: "child", parentId: activeParentTree.id, path: node.path, childRefId: node.child.id, revisionId: node.child.revisionId, assetPath: node.child.model.selectedRevision.assetPath ?? null });
    setLibraryPreviewModel(""); setPreviewModel(""); beginAssetRefine(activeParentTree, node.child);
  };
  const stagePreview = draft ? <Atom className={CLASS.modelingLibraryPreviewState}><SketchReview draft={draft} pending={draftDecisionPending || buildInProgress} onSave={(iteration, strokes) => void saveSketchMarkup(iteration, strokes)} onFeedback={(iteration, feedbackPrompt) => void applySketchFeedback(iteration, feedbackPrompt)} onApprove={(iteration) => void approveSketch(iteration)} /></Atom>
    : analysisInProgress ? <Atom className={CLASS.modelingLibraryPreviewState} aria-live="polite"><ProcessProgressPanel><header><Label>OPENAI × BLENDER</Label><Copy>스케치를 준비 중입니다.</Copy></header></ProcessProgressPanel></Atom>
      : previewModel ? <ModelPreviewFrame className={joinClasses(CLASS.modelingLibraryPreview, CLASS.modelingFrame)} title={studio.previewTitle} src={previewSrc} />
        : libraryPreviewModel ? <ModelPreviewFrame className={joinClasses(CLASS.modelingLibraryPreview, CLASS.modelingFrame)} title={studio.assetLibrary.previewTitle} src={libraryPreviewSrc} aria-busy={libraryPreviewPending} />
          : focusedAsset?.assetPath ? <ModelPreviewFrame className={joinClasses(CLASS.modelingLibraryPreview, CLASS.modelingFrame)} title={focusedAsset.kind === "child" ? "선택한 자녀 3D 미리보기" : "선택한 부모 3D 미리보기"} src={modelPreviewSrc(focusedAsset.assetPath, focusedAsset.revisionId)} />
            : <Atom className={CLASS.modelingLibraryPreviewState} aria-live="polite"><Copy>{libraryPreviewPending ? studio.assetLibrary.previewPendingMessage : "부모 또는 자녀 모델을 선택하면 3D 미리보기와 승인 스케치가 이곳에 표시됩니다."}</Copy></Atom>;
  return <>
    <ModelingPreviewStage aria-label="모델링 공용 미리보기">{stagePreview}</ModelingPreviewStage>
    <ModelingCatalogLayout id={system.catalogId}>
    <ModelingStudio>
      <Surface className={CLASS.modelingForm}>
        <form onSubmit={submit}>
          <ModelingWorkspaceIntro><Label>OPENAI × BLENDER</Label><Atom as="h2">{editTarget ? editTarget.label : "새 부모 모델 생성"}</Atom><Copy>{editTarget ? "저장된 기준 모델과 선택하지 않은 형제 자산은 그대로 유지합니다. 이 작업은 보완 전용입니다." : "새 부모 모델과 최초 자녀 모델을 생성합니다. 첫 Blender 결과가 검증되기 전에는 제품 자산 라이브러리에 저장되지 않습니다."}</Copy></ModelingWorkspaceIntro>
          {editTarget ? <AssetEditContext><Label>수정 대상</Label><Copy>{editTarget.label} · 기준 부모 리비전 {editTarget.baseRootRevisionId}</Copy><ActionButton className={CLASS.modelingAction} onClick={() => { setEditTarget(null); setDraft(null); setPreviewModel(""); }}>보완 취소</ActionButton></AssetEditContext> : null}
          <Atom className={CLASS.modelingFields}>
            {models.length > 0 && selectField(studio.fields.model, model, setModel, models)}
            <FormField className={CLASS.modelingField} label="제품명"><input className={CLASS.modelingControl} value={productName} onChange={(event) => setProductName(event.target.value)} /></FormField>
            <FormField className={joinClasses(CLASS.modelingField, CLASS.modelingFieldWide)} label="모델링할 컴포넌트">
              <input className={CLASS.modelingControl} required value={componentInput} onChange={(event) => setComponentInput(event.target.value)} placeholder="예: 유리병, 뚜껑, 밀봉 라이너" />
              <Copy className={CLASS.modelingHint}>쉼표로 구분합니다. 입력한 항목만 분석·승인·생성하며, 뚜껑만 입력하면 뚜껑만 새 버전으로 생성합니다.</Copy>
            </FormField>
            <FormField className={joinClasses(CLASS.modelingField, CLASS.modelingFieldWide)} label={studio.fields.prompt}>
              <textarea className={joinClasses(CLASS.modelingControl, CLASS.modelingTextarea)} value={prompt} onChange={(event) => setPrompt(event.target.value)} />
            </FormField>
            <FormField className={joinClasses(CLASS.modelingField, CLASS.modelingFieldWide)} label={studio.fields.images}>
              <input className={CLASS.modelingControl} type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => setImages(Array.from(event.target.files ?? []))} />
              <Copy className={CLASS.modelingHint}>{images.length ? `${images.length}장 선택됨 · 작업 완료 후 7일 보관` : "선택 사항 · JPEG/PNG/WebP 최대 4장, 각 10MB"}</Copy>
            </FormField>
          </Atom>
          {!draft && <ActionButton className={CLASS.modelingButton} type="submit" disabled={pending}>{pending ? "제품 분석 중" : editTarget?.mode === "refine-node" ? "선택한 자녀 분석 시작" : editTarget?.mode === "refine-assembly" ? "선택한 부모·자녀 분석 시작" : editTarget?.mode === "add-child" ? "새 하위 자산 분석 시작" : "새 부모 모델 분석 시작"}</ActionButton>}
          <Copy className={CLASS.modelingHint}>{progress || studio.unavailableMessage}</Copy>
        </form>
      </Surface>
    </ModelingStudio>
    {buildInProgress ? <BuildProgressPanel><ProcessProgressPanel>
        <header><Label>OPENAI × BLENDER · Blender 생성·검증</Label><ReviewStatus>진행 중</ReviewStatus><Copy>{progress || studio.pendingLabel}</Copy></header>
        <ProgressStageList>{(draft?.progress?.filter((item) => item.operation === "build") ?? [{ eventId: 0, operation: "build", stage: "Blender 생성", state: "running", message: progress }]).map((item) => <ProgressStage state={item.state} key={`${item.eventId}-${item.stage}`}><span>{item.stage}{item.total ? ` · ${item.completed ?? 0}/${item.total} ${item.unit ?? ""}` : ""}</span><span>{item.message}</span></ProgressStage>)}{Object.entries(componentProgress).map(([component, item]) => <ProgressStage state={item.state === "complete" ? "complete" : item.state === "failed" ? "failed" : "running"} key={component}><span>{component}</span><span>{item.message}</span></ProgressStage>)}</ProgressStageList>
      </ProcessProgressPanel></BuildProgressPanel> : analysisInProgress ? <ProcessProgressPanel>
        <header><Label>OPENAI × BLENDER · 제품·부품 분석</Label><ReviewStatus>분석 중</ReviewStatus><Copy>{progress || "제품과 구성 부품을 분석하고 있습니다."}</Copy></header>
        <ProgressStageList>{(draft?.progress?.filter((item) => item.operation === "analysis") ?? [{ eventId: 0, operation: "analysis", stage: "OpenAI 분석", state: "running", message: progress || "입력 분석을 시작했습니다." }]).map((item) => <ProgressStage state={item.state} key={`${item.eventId}-${item.stage}`}><span>{item.stage}{item.total ? ` · ${item.completed ?? 0}/${item.total} ${item.unit ?? ""}` : ""}</span><span>{item.message}</span></ProgressStage>)}</ProgressStageList>
      </ProcessProgressPanel> : previewModel ? <ModelResultPanel>
        <Atom className={CLASS.modelingToolbar}><Atom><Label>{studio.workspace.assemblyLabel}</Label><Copy className={CLASS.modelingHint}>{studio.workspace.assemblyDescription}</Copy></Atom><Link href="/">{studio.backLabel}</Link></Atom>
        <Atom className={joinClasses(CLASS.modelingResult, error && CLASS.modelingError)}><Label>{studio.resultTitle}</Label><Atom as={ELEMENT.span}>{error || result}</Atom>{downloadReady && <Link href={previewModel} download>{studio.downloadLabel}</Link>}</Atom>
        {draft ? <DecisionHistoryDisclosure label="승인 결정 내역 보기"><ReviewProgress>생성 당시 승인값 {draft.questions.length}개</ReviewProgress><DraftQuestionGroups draft={draft} readOnly /></DecisionHistoryDisclosure> : null}
      </ModelResultPanel> : draft ? <ReviewWorkspace>
        <ReviewWorkspaceHeader><Label>OPENAI × BLENDER · 승인 워크플로</Label><ReviewStatus>{draft.state}</ReviewStatus><Copy>{error || draft.message}</Copy></ReviewWorkspaceHeader>
        <WorkflowStepper>{MODELING_WORKFLOW_STEPS.map((step, index) => <WorkflowStep status={index < activeWorkflowIndex ? "completed" : index === activeWorkflowIndex ? "current" : "upcoming"} key={step}>{index + 1}. {step}</WorkflowStep>)}</WorkflowStepper>
        <ReviewProgress>{draft.approval?.ready ? "모든 값 승인됨" : `승인 대기 ${draft.approval?.blockers.length ?? draft.questions.length}개`}</ReviewProgress>
        <ReviewScopeNavigator onKeyDown={(event) => { if (!reviewScopes.length || !["ArrowLeft", "ArrowRight"].includes(event.key)) return; event.preventDefault(); const index = reviewScopes.findIndex((scope) => scope.id === activeReviewScope); setActiveReviewScope(reviewScopes[(index + (event.key === "ArrowRight" ? 1 : reviewScopes.length - 1)) % reviewScopes.length].id); }}>
          {reviewScopes.map((scope) => { const questions = scope.id === "assembly" ? draft.questions.filter((question) => ["product", "assembly", "interface"].includes(question.scope)) : scope.id === "graphics" ? draft.questions.filter((question) => question.scope === "sticker-slot") : draft.questions.filter((question) => question.componentInstanceId === scope.id); const outstanding = questions.filter((question) => !["accepted", "overridden"].includes(question.status)).length; return <ReviewScopeControl active={activeReviewScope === scope.id} key={scope.id} onClick={() => setActiveReviewScope(scope.id)}>{scope.label} · {questions.length - outstanding}/{questions.length}</ReviewScopeControl>; })}
        </ReviewScopeNavigator>
        {activeReviewScope === "assembly" && draft.product ? <ProposalCard><Label>제품·조립 기준</Label><Copy>{draft.product.name} · {draft.product.intendedUse ?? "제품 용도 확인 필요"}</Copy></ProposalCard> : null}
        {!(["assembly", "graphics"].includes(activeReviewScope)) ? <ProposalCard><Label>선택한 구성 부품</Label><Copy>{draft.components.find((component) => component.id === activeReviewScope)?.summary ?? "지정된 컴포넌트의 형상·재질·결합값을 확인합니다."}</Copy>{activeScopeLinkedQuestions.map((question) => <Copy key={question.id}>연결된 제품·조립 기준 · {parameterLabel(question)}: {parameterValue(question)}</Copy>)}</ProposalCard> : null}
        {draft.components.length > 0 && activeReviewScope === "assembly" ? <ProposalCard><Label>지정한 구성 부품</Label>{draft.components.map((component) => <Copy key={component.id}>{component.displayName} · {component.semanticRole} · {component.recipe} · {component.quantity}개</Copy>)}</ProposalCard> : null}
        {!["assembly", "graphics"].includes(activeReviewScope) ? <ScopedApprovalBar><Copy>이 컴포넌트의 아직 수정하지 않은 권장값 {activeScopeQuestions.filter((question) => question.status === "proposed").length}개만 한 번에 승인합니다.</Copy><ActionButton className={CLASS.modelingAction} disabled={draftDecisionPending || activeScopeQuestions.every((question) => question.status !== "proposed")} onClick={() => void approveCurrentScope()}>현재 컴포넌트 권장값 일괄 승인</ActionButton></ScopedApprovalBar> : null}
        <DraftQuestionGroups draft={draft} questions={activeScopeQuestions} decisionPending={draftDecisionPending} onDecision={(question, action, value) => void decideDraftQuestion(question, action, value)} />
        <BuildGate><Copy>{draft.approval?.ready ? "모든 기준값이 승인되었습니다." : `승인 대기 ${draft.approval?.blockers.length ?? draft.questions.length}개`}</Copy><ActionButton className={CLASS.modelingButton} disabled={!draft.approval?.ready || pending} onClick={() => void buildDraft()}>{pending ? studio.pendingLabel : "승인된 Blender 생성 실행"}</ActionButton></BuildGate>
      </ReviewWorkspace> : <ModelingLibraryWorkspace>
      <ModelingWorkspaceIntro><Label>PRODUCT ASSET LIBRARY</Label><Atom as="h2">{studio.assetLibrary.title}</Atom><Copy>{studio.assetLibrary.copy}</Copy></ModelingWorkspaceIntro>
      <AssetLibraryGrid aria-label="제품 모델과 SKU 연결 카드 목록">
        {productModels.length === 0 ? <AssetLibraryCard><AssetEmptyState><Label>저장된 부모 모델이 없습니다.</Label><Copy>새 부모 모델의 첫 Blender 결과가 검증되면 이 목록에 추가됩니다.</Copy></AssetEmptyState></AssetLibraryCard> : productModels.map((productModel) => <AssetLibraryCard key={productModel.id} selected={productModel.id === activeParentModelId}>
          <SelectionCardControl aria-pressed={productModel.id === activeParentModelId} onClick={() => focusParent(productModel)}>
            <AssetIdentity>{productModel.currentRevision?.assetPath ? <ModelPreviewFrame compact title={`${productModel.name} 조립 3D 미리보기`} src={modelPreviewSrc(productModel.currentRevision.assetPath, productModel.currentRevision.id)} /> : <AssetEmptyState><Copy>아직 조립 GLB가 없습니다.</Copy></AssetEmptyState>}<strong>{productModel.name}</strong><small>최신 r{productModel.currentRevision?.ordinal ?? 0} · 게시 {productModel.publishedRevision ? `r${productModel.publishedRevision.ordinal}` : "없음"} · 직계 {productModel.directChildren} · 전체 {productModel.descendantCount}</small></AssetIdentity>
          </SelectionCardControl>
          <FormField label="판매 SKU" className={CLASS.modelingField}><select className={CLASS.modelingControl} disabled={bindingPendingId === productModel.id} value={productModel.linkedSkuId ?? ""} onChange={(event) => void bindSku(productModel, event.target.value || null)}><option value="">연결 없음</option>{skuOptions.map((sku) => { const linked = productModels.find((item) => item.linkedSkuId === sku.id && item.id !== productModel.id); return <option value={sku.id} disabled={Boolean(linked)} key={sku.id}>{sku.label}{linked ? ` · ${linked.name}에 연결됨` : ""}</option>; })}</select></FormField>
          <ReviewStatus>{bindingPendingId === productModel.id ? "저장 중" : productModel.status}</ReviewStatus>
          <AssetNodeActions><ActionButton className={CLASS.modelingAction} onClick={() => setEditingName({ id: productModel.id, value: productModel.name, revision: productModel.revision })}>이름 수정</ActionButton><ActionButton className={CLASS.modelingAction} onClick={() => focusParent(productModel)}>전체 보완</ActionButton><ActionButton className={CLASS.modelingAction} disabled={Boolean(productModel.linkedSkuId) || assetActionPending === productModel.id} onClick={() => setDeleteTarget(productModel)}>삭제</ActionButton></AssetNodeActions>
        </AssetLibraryCard>)}
      </AssetLibraryGrid>
      {editingName && productModels.some((item) => item.id === editingName.id) ? <InlineAssetEditor onSubmit={(event) => { event.preventDefault(); void saveModelName(); }}><FormField label="부모 모델 이름"><input className={CLASS.modelingControl} value={editingName.value} onChange={(event) => setEditingName((current) => current ? { ...current, value: event.target.value } : current)} /></FormField><ActionButton className={CLASS.modelingAction} type="submit" disabled={assetActionPending === editingName.id}>저장</ActionButton></InlineAssetEditor> : null}
      {deleteTarget ? <DestructiveActionGate><Label>부모 모델 삭제</Label><Copy>{deleteTarget.name}은 복구 가능한 보관 상태로 전환됩니다. 게시 artifact와 과거 리비전은 보존됩니다.{deleteTarget.linkedSkuId ? " SKU 연결을 먼저 해제해야 합니다." : ""}</Copy><AssetNodeActions><ActionButton className={CLASS.modelingAction} onClick={() => setDeleteTarget(null)}>취소</ActionButton><ActionButton className={CLASS.modelingAction} disabled={Boolean(deleteTarget.linkedSkuId) || assetActionPending === deleteTarget.id} onClick={() => void archiveParent()}>삭제 확인</ActionButton></AssetNodeActions></DestructiveActionGate> : null}
      {activeParentTree ? <ModelingLibraryTree>
        <Atom className={CLASS.modelingParentToolbar}><AssetIdentity><strong>{activeParentTree.name}</strong><small>최신 r{activeParentTree.currentRevision?.ordinal ?? 0} · 게시 {activeParentTree.publishedRevision ? `r${activeParentTree.publishedRevision.ordinal}` : "없음"} · {activeParentTree.status}</small></AssetIdentity><AssetNodeActions><ActionButton className={CLASS.modelingAction} onClick={() => beginAssetRefine(activeParentTree)}>전체 조립 보완</ActionButton><ActionButton className={CLASS.modelingAction} onClick={() => beginAddChild(activeParentTree)}>하위 자산 추가</ActionButton></AssetNodeActions></Atom>
        {flatAssetNodes.length ? <AssetLibraryGrid aria-label={`${activeParentTree.name} 하위 자산 카드 목록`}>{flatAssetNodes.map((node) => {
          const item = node.child.model; const included = includedNodePaths.includes(node.path); const focused = focusedAsset?.kind === "child" && focusedAsset.path === node.path;
          const canMutate = node.depth === 0 && activeParentTree.selectedRevision.id === activeParentTree.currentRevision?.id;
          return <AssetLibraryCard key={node.path} selected={focused}>
            <SelectionCardControl aria-pressed={focused} onClick={() => focusChild(node)}>
              <AssetIdentity>{item.selectedRevision.assetPath ? <ModelPreviewFrame compact title={`${item.name} 3D 미리보기`} src={modelPreviewSrc(item.selectedRevision.assetPath, item.selectedRevision.id)} /> : <AssetEmptyState><Copy>자체 GLB가 없어 하위 자산 조립으로 표시됩니다.</Copy></AssetEmptyState>}<strong>{item.name}</strong><small>{node.breadcrumb.join(" › ")} · r{item.selectedRevision.ordinal} · {item.status} · 조립 순서 {node.child.order + 1}</small></AssetIdentity>
            </SelectionCardControl>
            <SelectionCardControl aria-pressed={included} onClick={() => toggleIncludedNodePath(node.path)}>{included ? "조립에서 제외" : "조립에 포함"}</SelectionCardControl>
            <AssetNodeActions aria-label={`${item.name} 작업`}><ActionButton className={CLASS.modelingAction} onClick={() => setEditingName({ id: item.id, value: item.name, revision: item.revision })}>이름 수정</ActionButton><ActionButton className={CLASS.modelingAction} onClick={() => focusChild(node)}>OpenAI × Blender로 보완</ActionButton>{canMutate ? <><ActionButton className={CLASS.modelingAction} onClick={() => beginAddChild(activeParentTree)}>하위 자산 추가</ActionButton><ActionButton className={CLASS.modelingAction} disabled={assetActionPending === node.child.id} onClick={() => void removeChildAsset(activeParentTree, node.child.id)}>삭제</ActionButton></> : null}</AssetNodeActions>
          </AssetLibraryCard>;
        })}</AssetLibraryGrid> : <AssetEmptyState><Label>하위 자산 없음</Label><Copy>OpenAI × Blender 보완에서 첫 구성 부품을 추가할 수 있습니다.</Copy></AssetEmptyState>}
      </ModelingLibraryTree> : <AssetEmptyState><Label>선택한 부모 모델 없음</Label><Copy>새 부모 모델을 만들거나 기존 모델을 선택하세요.</Copy></AssetEmptyState>}
      {modelListError ? <Atom as="p" className={joinClasses(CLASS.modelingHint, CLASS.modelingError)} role="alert">{modelListError}</Atom> : null}
      <Atom className={CLASS.modelingLibraryHeader}>
        <Label>조립 선택</Label>
        <Copy>선택한 부모 모델의 현재 하위 자산만 조립합니다. 다른 부모의 전역 버전은 이 조립에 섞이지 않습니다.</Copy>
      </Atom>
      <Atom className={CLASS.modelingLibrarySelection}>
        <Atom className={CLASS.modelingLibrarySelectionMeta}>
          <Label>{studio.assetLibrary.selectionTitle}</Label>
          <Copy>{includedNodePaths.length ? `${includedNodePaths.length}개 하위 자산 선택 · 활성 부모: ${activeParentTree?.name ?? "선택 필요"}` : "하위 자산 카드에서 조립할 항목을 선택하세요."}</Copy>
        </Atom>
        <Atom className={CLASS.modelingLibraryActions} role="group" aria-label="선택한 자산 작업">
          <ActionButton className={CLASS.modelingAction} disabled={!activeParentTree || includedNodePaths.length === 0 || libraryPreviewPending} onClick={() => void requestTreePreview()}>{studio.assetLibrary.previewLabel}</ActionButton>
          <ActionButton className={CLASS.modelingAction} disabled={!activeParentTree || includedNodePaths.length === 0 || !productModels.find((item) => item.id === activeParentModelId)?.linkedSkuId || libraryPreviewPending} onClick={() => void publishSelectedChildren()}>{studio.assetLibrary.homeLabel}</ActionButton>
        </Atom>
        {libraryPreviewPending && libraryPreviewModel ? <Copy className={CLASS.modelingHint}>{studio.assetLibrary.previewPendingMessage}</Copy> : null}
        {libraryError ? <Atom as="p" className={joinClasses(CLASS.modelingHint, CLASS.modelingError)} role="alert">{libraryError}</Atom> : null}
      </Atom>
      {!activeParentTree ? <AssetEmptyState><Label>부모 모델을 선택하세요</Label><Copy>이전 전역 컴포넌트 버전은 부모 자산 트리와 섞지 않습니다.</Copy></AssetEmptyState> : null}
      {archivedParents.length ? <DecisionHistoryDisclosure label={`삭제된 부모 모델 ${archivedParents.length}개`}><AssetHierarchy>{archivedParents.map((item) => <AssetHierarchyItem key={item.id}><AssetIdentity><strong>{item.name}</strong><small>보관됨 · 마지막 리비전 r{item.currentRevision?.ordinal ?? 0}</small></AssetIdentity><AssetNodeActions><ActionButton className={CLASS.modelingAction} disabled={assetActionPending === item.id} onClick={() => void restoreParent(item)}>복원</ActionButton></AssetNodeActions></AssetHierarchyItem>)}</AssetHierarchy></DecisionHistoryDisclosure> : null}
    </ModelingLibraryWorkspace>}
    <ModelingOutputSections>
      <Surface className={CLASS.modelingOutputSection}>
        <Label>{studio.workspace.manufacturingLabel}</Label>
        <Copy>현재 작업에서 생성된 제조 검토용 산출물과 검증 보고서를 확인합니다.</Copy>
        {resultArtifacts.report ? <Link href={resultArtifacts.report} target="_blank" rel="noreferrer">검증 보고서 열기</Link> : <Copy className={CLASS.modelingHint}>작업을 완료하면 검증 보고서가 여기에 표시됩니다.</Copy>}
      </Surface>
      <Surface className={CLASS.modelingOutputSection}>
        <Label>{studio.workspace.publicationLabel}</Label>
        <Copy>자산 라이브러리에서 버전을 선택해 홈페이지에 표시할 조립 모델을 지정합니다.</Copy>
        <Link href="/">홈페이지 3D 뷰어 열기</Link>
      </Surface>
    </ModelingOutputSections>
    </ModelingCatalogLayout>
  </>;
}

function CatalogRegion(props: { definition: ProductPageDefinition; onRenderedLabel: (value: ActiveRenderedLabel | null) => void }) {
  return props.definition.catalog.presentation === "modeling"
    ? <ModelingCatalogRegion definition={props.definition} />
    : <ProductCatalogRegion {...props} />;
}

function PrinciplesRegion({ definition }: { definition: ProductPageDefinition }) {
  return <Container as={ELEMENT.section} className={joinClasses(CLASS.section, CLASS.principles)} id={definition.system.principlesId}>
    <SectionHeading {...definition.principlesSection} />
    <Atom className={CLASS.principleGrid}>{definition.principles.map((item) => <Surface key={item.code}>
      <Label>{item.code}</Label><Atom as={ELEMENT.strong}>{item.title}</Atom><Copy>{item.copy}</Copy>
    </Surface>)}</Atom>
  </Container>;
}

function FooterRegion({ definition }: { definition: ProductPageDefinition }) {
  return <SiteFooter tagline={definition.brand.tagline} location={definition.brand.location} />;
}

export function Storefront({ definition }: { definition: ProductPageDefinition }) {
  const [bagCount] = useState(0);
  const [activeRenderedLabel, setActiveRenderedLabel] = useState<ActiveRenderedLabel | null>(null);
  const handleRenderedLabel = useCallback((value: ActiveRenderedLabel | null) => {
    setActiveRenderedLabel(value);
  }, []);
  const registry: Record<TemplateRegion, ReactNode> = {
    header: <HeaderRegion definition={definition} bagCount={bagCount} />,
    hero: <HeroRegion definition={definition} activeRenderedLabel={activeRenderedLabel} />,
    catalog: <CatalogRegion definition={definition} onRenderedLabel={handleRenderedLabel} />,
    principles: <PrinciplesRegion definition={definition} />,
    footer: <FooterRegion definition={definition} />,
  };
  return <Atom as={ELEMENT.main} data-design-order={definition.regions.join(",")}>
    {definition.regions.map((region) => <Fragment key={region}>{registry[region]}</Fragment>)}
  </Atom>;
}

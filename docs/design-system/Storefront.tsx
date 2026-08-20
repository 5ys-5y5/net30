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
import type { ElementType, FormEvent, ReactNode, RefObject } from "react";
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
} from "./index";
import {
  mergeComponentVersions,
  removeComponentVersion,
  removeSelectedVersion,
} from "./modeling-library-state";
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
  payload: ThreeDLabelPayload;
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
type ModelingDraft = { id: string; revision: number; state: string; message: string; input: { skuId: string; requestedComponents?: readonly string[]; componentInput?: string; revisionBaseRefs?: Record<string, { versionId: string }>; assemblyAssetRefs?: readonly { versionId: string }[] }; product: { name: string; intendedUse?: string } | null; components: readonly { id: string; requestedName?: string; displayName: string; semanticRole: string; quantity: number; recipe: string; summary?: string }[]; questions: readonly ModelingDraftQuestion[]; progress?: readonly ModelingProgress[]; approval?: { ready: boolean; blockers: readonly string[]; approvalHash: string; compiler?: { ready: boolean } } };

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

  useEffect(() => {
    onRenderedLabel(labelPayload ? { primaryId: primary.id, payload: labelPayload } : null);
  }, [labelPayload, onRenderedLabel, primary.id]);

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
  const { catalog, catalogSection, system } = definition;
  const studio = catalog.modeling;
  if (!studio) throw new Error("Modeling presentation requires catalog.modeling");

  const skuIds = catalog.skus.map((item) => item.id);
  const defaults = studio.defaults;
  const [components, setComponents] = useState<readonly string[]>(defaults.componentIds);
  const [componentInput, setComponentInput] = useState(defaults.componentIds.map((id) => studio.components.find((component) => component.id === id)?.label ?? id).join(", "));
  const [componentPrompts, setComponentPrompts] = useState<Record<string, string>>({});
  const [model, setModel] = useState(defaults.modelId);
  const [models, setModels] = useState<readonly { id: string; label: string }[]>([]);
  const [images, setImages] = useState<File[]>([]);
  const [material, setMaterial] = useState(defaults.materialId);
  const [shape, setShape] = useState(defaults.shapeId);
  const [skuId, setSkuId] = useState(skuIds[0] ?? "default-sku");
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
  const [selectedVersions, setSelectedVersions] = useState<Record<string, string>>({});
  const [libraryPreviewModel, setLibraryPreviewModel] = useState("");
  const [libraryPreviewRevision, setLibraryPreviewRevision] = useState("initial");
  const [libraryPreviewPending, setLibraryPreviewPending] = useState(false);
  const [libraryError, setLibraryError] = useState("");
  const libraryPreviewRequest = useRef(0);

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
    const controller = new AbortController();
    void fetch(`${studio.endpoint.replace(/\/jobs$/, "")}/showcase`, { signal: controller.signal }).then(async (response) => {
      const body = await response.json() as { ok?: boolean; showcase?: { assetPath?: string; component?: string; versionId?: string; selections?: readonly { component: string; versionId: string }[] } | null };
      const selections = body.showcase?.selections ?? (body.showcase?.component && body.showcase?.versionId ? [{ component: body.showcase.component, versionId: body.showcase.versionId }] : []);
      if (response.ok && body.ok && body.showcase?.assetPath && selections.length) {
        setSelectedVersions(Object.fromEntries(selections.map((item) => [item.component, item.versionId])));
        setLibraryPreviewModel(body.showcase.assetPath); setLibraryPreviewRevision(Date.now().toString());
      }
    }).catch(() => undefined);
    return () => controller.abort();
  }, [studio.endpoint]);

  const selectedAssembly = (selection = selectedVersions) => Object.entries(selection).map(([component, versionId]) => ({ component, versionId }));

  const requestLibraryPreview = async (selections: readonly { component: string; versionId: string }[]) => {
    const requestId = ++libraryPreviewRequest.current;
    setLibraryError("");
    if (!selections.length) {
      setLibraryPreviewModel("");
      setLibraryPreviewPending(false);
      return;
    }
    setLibraryPreviewPending(true);
    try {
      const response = await fetch(`${studio.endpoint.replace(/\/jobs$/, "")}/assemblies/preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ selections }),
      });
      const body = await response.json() as { ok?: boolean; error?: string; assembly?: { assetPath?: string } };
      if (!response.ok || !body.ok || !body.assembly?.assetPath) throw new Error(body.error ?? "선택한 조립 모델을 만들지 못했습니다.");
      if (requestId !== libraryPreviewRequest.current) return;
      setLibraryPreviewModel(body.assembly.assetPath);
      setLibraryPreviewRevision(Date.now().toString());
      setProgress("선택한 컴포넌트 버전을 제품 자산 라이브러리에서 조립해 표시했습니다.");
    } catch (requestError) {
      if (requestId === libraryPreviewRequest.current) setLibraryError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      if (requestId === libraryPreviewRequest.current) setLibraryPreviewPending(false);
    }
  };

  useEffect(() => {
    const selections = selectedAssembly();
    if (!selections.length) {
      libraryPreviewRequest.current += 1;
      setLibraryPreviewModel("");
      setLibraryPreviewPending(false);
      return;
    }
    const timer = window.setTimeout(() => { void requestLibraryPreview(selections); }, 300);
    return () => {
      window.clearTimeout(timer);
      libraryPreviewRequest.current += 1;
    };
  }, [selectedVersions]);

  const toggleLibraryVersion = (component: string, version: { id: string; ordinal: number }) => {
    setSelectedVersions((current) => {
      if (current[component] === version.id) {
        const { [component]: _removed, ...remaining } = current;
        return remaining;
      }
      return { ...current, [component]: version.id };
    });
    setProgress(`${component} v${version.ordinal}을 조립 선택에 반영했습니다.`);
  };

  const editVersion = (component: string, version: { id: string; ordinal: number; assetPath: string }) => {
    setSelectedVersions((current) => ({ ...current, [component]: version.id }));
    setComponents([component]);
    setParentVersionId({ [component]: version.id });
    setProgress(`v${version.ordinal}을 기반으로 수정할 준비가 되었습니다.`);
  };

  const previewSelectedVersions = async () => {
    const selections = selectedAssembly();
    if (!selections.length) {
      setLibraryError(studio.assetLibrary.selectionEmptyMessage);
      return;
    }
    await requestLibraryPreview(selections);
  };

  const publishSelectedVersions = async () => {
    setLibraryError("");
    try {
      const selections = selectedAssembly();
      if (!selections.length) throw new Error(studio.assetLibrary.selectionEmptyMessage);
      const response = await fetch(`${studio.endpoint.replace(/\/jobs$/, "")}/showcase`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ selections }),
      });
      const body = await response.json() as { ok?: boolean; error?: string; showcase?: { assetPath?: string } };
      if (!response.ok || !body.ok || !body.showcase?.assetPath) throw new Error(body.error ?? "홈 표시 자산을 설정하지 못했습니다.");
      setLibraryPreviewModel(body.showcase.assetPath);
      setLibraryPreviewRevision(Date.now().toString());
      setProgress("선택한 컴포넌트 버전만 홈페이지 3D 뷰어에 표시하도록 설정했습니다.");
    } catch (requestError) {
      setLibraryError(requestError instanceof Error ? requestError.message : String(requestError));
    }
  };

  const deleteVersion = async (component: string, version: { id: string }) => {
    setLibraryError("");
    try {
      const response = await fetch(`${studio.endpoint.replace(/\/jobs$/, "")}/components/${component}/versions/${version.id}`, { method: "DELETE" });
      const body = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !body.ok) throw new Error(body.error ?? "저장된 자산을 삭제하지 못했습니다.");
      setVersions((current) => removeComponentVersion(current, component, version.id));
      setSelectedVersions((current) => removeSelectedVersion(current, component, version.id));
      await refreshVersions([component]);
    } catch (requestError) {
      setLibraryError(requestError instanceof Error ? requestError.message : String(requestError));
    }
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
      const response = await fetch(studio.endpoint.replace(/\/jobs$/, "/drafts"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          version: "net30.modeling-draft.v4", model: model || undefined, imageIds, prompt, skuId, componentInput,
          revisionBaseRefs: Object.fromEntries(Object.entries(parentVersionId).map(([component, versionId]) => [component, { versionId }])),
          assemblyAssetRefs: selectedAssembly().map((item) => ({ versionId: item.versionId })),
          product: { source: "new", name: productName },
        }),
      });
      const body = await response.json() as { ok?: boolean; error?: string; draft?: ModelingDraft; statusUrl?: string };
      if (!response.ok || !body.ok || !body.draft) throw new Error(body.error ?? `초안 요청 실패 (${response.status})`);
      setDraft(body.draft); setActiveReviewScope("assembly"); setProgress(body.draft.message);
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
  const buildDraft = async () => {
    if (!draft?.approval?.ready) return;
    setPending(true); setBuildInProgress(true); setError("");
    try {
      const response = await fetch(`${studio.endpoint.replace(/\/jobs$/, "/drafts")}/${draft.id}/build`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedRevision: draft.revision, approvalHash: draft.approval.approvalHash }) });
      const body = await response.json() as { ok?: boolean; error?: string; job?: { id: string; message: string }; statusUrl?: string };
      if (!response.ok || !body.ok || !body.job) throw new Error(body.error ?? "Blender 작업을 시작하지 못했습니다.");
      setProgress(body.job.message ?? "승인된 Blender 작업을 시작했습니다.");
      const statusUrl = body.statusUrl ?? `${studio.endpoint}/${body.job.id}`;
      for (;;) { await new Promise((resolve) => window.setTimeout(resolve, 1200)); const responseStatus = await fetch(statusUrl); const current = await responseStatus.json() as { ok?: boolean; job?: { state: string; message: string; components?: Record<string, { state: string; message: string; version?: string | null }>; result?: { artifact?: { assemblyGlb?: string; report?: string }; versions?: Record<string, { component?: string }> } }; error?: string }; if (!responseStatus.ok || !current.ok || !current.job) throw new Error(current.error ?? "작업 상태를 불러오지 못했습니다."); setProgress(current.job.message); setComponentProgress(current.job.components ?? {}); if (["complete", "review_required", "failed"].includes(current.job.state)) { if (current.job.state === "failed") throw new Error(current.job.message); const artifact=current.job.result?.artifact; setPreviewModel(artifact?.assemblyGlb ?? ""); setPreviewRevision(Date.now().toString()); setResultArtifacts(artifact ?? {}); setDownloadReady(Boolean(artifact?.assemblyGlb)); setResult(current.job.message); await refreshVersions(Object.keys(current.job.result?.versions ?? {})); break; } }
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
  const hasDecisionWorkspace = Boolean(draft || previewModel || buildInProgress || analysisInProgress);
  const activeWorkflowIndex = draft ? workflowIndex(draft.state, Boolean(previewModel)) : 0;

  return <Container as={ELEMENT.section} className={CLASS.section} id={system.catalogId}>
    <SectionHeading {...catalogSection} />
    <Atom className={CLASS.modelingWorkspace}>
      <Atom className={CLASS.modelingWorkspaceMeta}>
        <Label>{studio.workspace.productLabel}</Label>
        <Atom as={ELEMENT.span} className={CLASS.modelingWorkspaceName}>{studio.workspace.productName}</Atom>
      </Atom>
      <Copy>{studio.workspace.productDescription}</Copy>
    </Atom>
    <Atom className={CLASS.modelingStudio} data-workspace={hasDecisionWorkspace}>
      <Surface className={CLASS.modelingForm}>
        <form onSubmit={submit}>
          <Atom>
            <Label>{studio.title}</Label>
            <Copy>{studio.copy}</Copy>
          </Atom>
          <Atom className={CLASS.modelingFields}>
            {models.length > 0 && selectField(studio.fields.model, model, setModel, models)}
            <FormField className={CLASS.modelingField} label="제품명"><input className={CLASS.modelingControl} value={productName} onChange={(event) => setProductName(event.target.value)} /></FormField>
            {selectField("고정 HTML 그래픽 SKU", skuId, setSkuId, skuIds.map((id) => ({ id, label: id })))}
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
          {!draft && <ActionButton className={CLASS.modelingButton} type="submit" disabled={pending}>{pending ? "제품 분석 중" : "제품·부품 분석 시작"}</ActionButton>}
          <Copy className={CLASS.modelingHint}>{progress || studio.unavailableMessage}</Copy>
        </form>
      </Surface>
      {buildInProgress ? <BuildProgressPanel><ProcessProgressPanel>
        <header><Label>Blender 생성·검증</Label><ReviewStatus>진행 중</ReviewStatus><Copy>{progress || studio.pendingLabel}</Copy></header>
        <ProgressStageList>{(draft?.progress?.filter((item) => item.operation === "build") ?? [{ eventId: 0, operation: "build", stage: "Blender 생성", state: "running", message: progress }]).map((item) => <ProgressStage state={item.state} key={`${item.eventId}-${item.stage}`}><span>{item.stage}{item.total ? ` · ${item.completed ?? 0}/${item.total} ${item.unit ?? ""}` : ""}</span><span>{item.message}</span></ProgressStage>)}{Object.entries(componentProgress).map(([component, item]) => <ProgressStage state={item.state === "complete" ? "complete" : item.state === "failed" ? "failed" : "running"} key={component}><span>{component}</span><span>{item.message}</span></ProgressStage>)}</ProgressStageList>
      </ProcessProgressPanel></BuildProgressPanel> : analysisInProgress ? <ProcessProgressPanel>
        <header><Label>제품·부품 분석</Label><ReviewStatus>분석 중</ReviewStatus><Copy>{progress || "제품과 구성 부품을 분석하고 있습니다."}</Copy></header>
        <ProgressStageList>{(draft?.progress?.filter((item) => item.operation === "analysis") ?? [{ eventId: 0, operation: "analysis", stage: "OpenAI 분석", state: "running", message: progress || "입력 분석을 시작했습니다." }]).map((item) => <ProgressStage state={item.state} key={`${item.eventId}-${item.stage}`}><span>{item.stage}{item.total ? ` · ${item.completed ?? 0}/${item.total} ${item.unit ?? ""}` : ""}</span><span>{item.message}</span></ProgressStage>)}</ProgressStageList>
      </ProcessProgressPanel> : previewModel ? <ModelResultPanel>
        <Atom className={CLASS.modelingToolbar}><Atom><Label>{studio.workspace.assemblyLabel}</Label><Copy className={CLASS.modelingHint}>{studio.workspace.assemblyDescription}</Copy></Atom><Link href="/">{studio.backLabel}</Link></Atom>
        <ModelPreviewFrame className={CLASS.modelingFrame} title={studio.previewTitle} src={previewSrc} />
        <Atom className={joinClasses(CLASS.modelingResult, error && CLASS.modelingError)}><Label>{studio.resultTitle}</Label><Atom as={ELEMENT.span}>{error || result}</Atom>{downloadReady && <Link href={previewModel} download>{studio.downloadLabel}</Link>}</Atom>
        {draft ? <DecisionHistoryDisclosure label="승인 결정 내역 보기"><ReviewProgress>생성 당시 승인값 {draft.questions.length}개</ReviewProgress><DraftQuestionGroups draft={draft} readOnly /></DecisionHistoryDisclosure> : null}
      </ModelResultPanel> : draft ? <ReviewWorkspace>
        <ReviewWorkspaceHeader><Label>승인 워크플로</Label><ReviewStatus>{draft.state}</ReviewStatus><Copy>{error || draft.message}</Copy></ReviewWorkspaceHeader>
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
      </ReviewWorkspace> : null}
    </Atom>
    <Surface className={CLASS.modelingLibrary}>
      <Atom className={CLASS.modelingLibraryHeader}>
        <Label>{studio.assetLibrary.title}</Label>
        <Copy>{studio.assetLibrary.copy}</Copy>
      </Atom>
      <Atom className={CLASS.modelingLibrarySelection}>
        <Atom className={CLASS.modelingLibrarySelectionMeta}>
          <Label>{studio.assetLibrary.selectionTitle}</Label>
          <Copy>{Object.keys(selectedVersions).length ? studio.assetLibrary.selectionSummary(Object.keys(selectedVersions).length) : studio.assetLibrary.selectionEmptyMessage}</Copy>
        </Atom>
        <Atom className={CLASS.modelingLibraryActions} role="group" aria-label="선택한 자산 작업">
          <ActionButton className={CLASS.modelingAction} disabled={Object.keys(selectedVersions).length === 0} onClick={() => void previewSelectedVersions()}>{studio.assetLibrary.previewLabel}</ActionButton>
          <ActionButton className={CLASS.modelingAction} disabled={Object.keys(selectedVersions).length === 0} onClick={() => void publishSelectedVersions()}>{studio.assetLibrary.homeLabel}</ActionButton>
        </Atom>
        {libraryPreviewModel
          ? <ModelPreviewFrame className={CLASS.modelingLibraryPreview} title={studio.assetLibrary.previewTitle} src={libraryPreviewSrc} aria-busy={libraryPreviewPending} />
          : <Atom className={CLASS.modelingLibraryPreviewState} aria-live="polite"><Copy>{libraryPreviewPending ? studio.assetLibrary.previewPendingMessage : studio.assetLibrary.previewIdleMessage}</Copy></Atom>}
        {libraryPreviewPending && libraryPreviewModel ? <Copy className={CLASS.modelingHint}>{studio.assetLibrary.previewPendingMessage}</Copy> : null}
        {libraryError ? <Atom as="p" className={joinClasses(CLASS.modelingHint, CLASS.modelingError)} role="alert">{libraryError}</Atom> : null}
      </Atom>
      <Atom className={CLASS.modelingLibraryGrid}>{studio.componentGroups.map((group) => <Surface className={CLASS.modelingAssetGroup} key={group.id}>
        <Atom as="header" className={CLASS.modelingAssetGroupHeader}>
          <Label>{group.label}</Label>
          <Copy>{group.description}</Copy>
        </Atom>
        <Atom className={CLASS.modelingAssetList}>
          {group.componentIds.map((componentId) => {
            const component = studio.components.find((item) => item.id === componentId);
            if (!component) return null;
            const items = versions[component.id] ?? [];
            return <Atom as="section" className={CLASS.modelingVersionList} aria-label={component.label} key={component.id}>
              <Label>{component.label}</Label>
              {items.length === 0 ? <Copy className={CLASS.modelingHint}>{studio.assetLibrary.emptyMessage}</Copy> : items.map((version) => <SelectionCard className={CLASS.modelingVersion} selected={selectedVersions[component.id] === version.id} key={version.id}>
                <ModelPreviewFrame className={CLASS.modelingVersionPreview} title={`${component.label} v${version.ordinal} 3D 미리보기`} src={modelPreviewSrc(version.assetPath, version.id)} />
                <SelectionCardControl
                  aria-label={`${component.label} v${version.ordinal} ${studio.assetLibrary.selectionLabel}`}
                  aria-pressed={selectedVersions[component.id] === version.id}
                  onClick={() => toggleLibraryVersion(component.id, version)}
                >
                  <Atom className={CLASS.modelingVersionContent}>
                    <Atom className={CLASS.modelingAssetMeta}>
                      <Label>version</Label>
                      <Atom as={ELEMENT.strong}>v{version.ordinal}</Atom>
                    </Atom>
                    <Copy>{new Date(version.createdAt).toLocaleString()} · {version.summary}</Copy>
                  </Atom>
                </SelectionCardControl>
                <Atom className={CLASS.modelingActions} role="group" aria-label={`${component.label} v${version.ordinal} 작업`}>
                  <ActionButton className={CLASS.modelingAction} onClick={() => editVersion(component.id, version)}>{studio.assetLibrary.editLabel}</ActionButton>
                  <ActionButton className={CLASS.modelingAction} onClick={() => void deleteVersion(component.id, version)}>{studio.assetLibrary.deleteLabel}</ActionButton>
                </Atom>
              </SelectionCard>)}
            </Atom>;
          })}
        </Atom>
      </Surface>)}</Atom>
    </Surface>
    <Atom className={CLASS.modelingOutputSections}>
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
    </Atom>
  </Container>;
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

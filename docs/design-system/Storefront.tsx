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
  Atom,
  Container,
  Copy,
  GridCell,
  KoreanSupplementLabel,
  Label,
  LabeledChoice,
  Link,
  Metric,
  Panel,
  PanelBody,
  PanelFooter,
  PanelHeader,
  ProductVisual,
  SectionHeading,
  SiteFooter,
  SiteHeader,
  Surface,
  SurfaceGrid,
} from "./index";
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
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [previewRevision, setPreviewRevision] = useState("initial");
  const [previewModel, setPreviewModel] = useState("");
  const [progress, setProgress] = useState("");
  const [downloadReady, setDownloadReady] = useState(false);

  const previewJoin = studio.previewSrc.includes("?") ? "&" : "?";
  const previewSrc = `${studio.previewSrc}${previewJoin}refresh=${previewRevision}${previewModel ? `&model=${encodeURIComponent(previewModel)}` : ""}`;

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
    setPending(true);
    setResult("");
    setError("");
    setDownloadReady(false);
    setProgress(images.length ? "이미지 업로드 중" : "모델링 지시 준비 중");
    try {
      const imageIds = await uploadImages();
      setProgress("OpenAI가 모델링 구조를 분석 중");
      const response = await fetch(studio.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          version: "net30.modeling-job.v2", components, componentPrompts, model: model || undefined, imageIds,
          prompt,
          dimensionOverrides: { widthMm: sizeXmm, heightMm: sizeYmm, depthMm: sizeZmm, wallMm: shellThicknessMm },
          settings: { material, shape, tone, finish, presetSkuId: skuId }, quality: "high",
        }),
      });
      setProgress("조립 계약과 Blender 작업을 시작했습니다.");
      const body = await response.json() as { ok?: boolean; error?: string; job?: { id: string; state: string; message: string }; statusUrl?: string };
      if (!response.ok || !body.ok) throw new Error(body.error ?? `모델링 요청 실패 (${response.status})`);
      const statusUrl = body.statusUrl ?? `${studio.endpoint}/${body.job?.id}`;
      for (;;) {
        await new Promise((resolve) => window.setTimeout(resolve, 1200));
        const statusResponse = await fetch(statusUrl); const statusBody = await statusResponse.json() as { ok?: boolean; job?: { state: string; message: string; result?: { artifact?: { assemblyGlb?: string }; report?: { requiredReview?: string[] } } }; error?: string };
        if (!statusResponse.ok || !statusBody.ok || !statusBody.job) throw new Error(statusBody.error ?? "작업 상태를 불러오지 못했습니다.");
        setProgress(statusBody.job.message);
        if (["complete", "review_required", "failed"].includes(statusBody.job.state)) {
          if (statusBody.job.state === "failed") throw new Error(statusBody.job.message);
          const asset = statusBody.job.result?.artifact?.assemblyGlb ?? "";
          setPreviewModel(asset); setPreviewRevision(Date.now().toString()); setDownloadReady(Boolean(asset));
          setResult([statusBody.job.message, statusBody.job.state === "review_required" ? "제조용 STEP은 나사·공차의 공식 도면 확인 후 엔지니어 검토가 필요합니다." : "엔지니어 검토용 제조 후보를 생성했습니다.", asset].filter(Boolean).join("\n")); break;
        }
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setPending(false);
    }
  };

  const selectField = (label: string, value: string, onChange: (value: string) => void, options: readonly { id: string; label: string }[]) => <label className={CLASS.modelingField}>
    <Label>{label}</Label>
    <select className={CLASS.modelingControl} value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => <option value={option.id} key={option.id}>{option.label}</option>)}
    </select>
  </label>;
  const numberField = (label: string, value: number, onChange: (value: number) => void, step = "1") => <label className={CLASS.modelingField}>
    <Label>{label}</Label>
    <input className={CLASS.modelingControl} type="number" step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
  </label>;

  return <Container as={ELEMENT.section} className={CLASS.section} id={system.catalogId}>
    <SectionHeading {...catalogSection} />
    <Atom className={CLASS.modelingStudio}>
      <Surface className={CLASS.modelingForm}>
        <form onSubmit={submit}>
          <Atom>
            <Label>{studio.title}</Label>
            <Copy>{studio.copy}</Copy>
          </Atom>
          <Atom className={CLASS.modelingFields}>
            {models.length > 0 && selectField(studio.fields.model, model, setModel, models)}
            <fieldset className={joinClasses(CLASS.modelingField, CLASS.modelingFieldWide)}><Label>{studio.fields.component}</Label>
              {studio.components.map((option) => <label key={option.id}><input type="checkbox" checked={components.includes(option.id)} onChange={(event) => setComponents((current) => event.target.checked ? [...current, option.id] : current.filter((id) => id !== option.id))} /> {option.label}</label>)}
              {components.map((id) => <input className={CLASS.modelingControl} key={id} aria-label={`${id} 추가 지시`} placeholder={`${studio.components.find((item) => item.id === id)?.label ?? id} 추가 지시 (선택)`} value={componentPrompts[id] ?? ""} onChange={(event) => setComponentPrompts((current) => ({ ...current, [id]: event.target.value }))} />)}
            </fieldset>
            {selectField(studio.fields.sku, skuId, setSkuId, skuIds.map((id) => ({ id, label: id })))}
            {selectField(studio.fields.material, material, setMaterial, studio.materials)}
            {selectField(studio.fields.shape, shape, setShape, studio.shapes)}
            {numberField(studio.fields.sizeXmm, sizeXmm, setSizeXmm)}
            {numberField(studio.fields.sizeYmm, sizeYmm, setSizeYmm)}
            {numberField(studio.fields.sizeZmm, sizeZmm, setSizeZmm)}
            {numberField(studio.fields.shellThicknessMm, shellThicknessMm, setShellThicknessMm, "0.1")}
            {numberField(studio.fields.distortion, distortion, setDistortion, "0.01")}
            <label className={CLASS.modelingField}><Label>{studio.fields.tone}</Label><input className={CLASS.modelingControl} type="color" value={tone} onChange={(event) => setTone(event.target.value)} /></label>
            <label className={CLASS.modelingField}><Label>{studio.fields.finish}</Label><input className={CLASS.modelingControl} value={finish} onChange={(event) => setFinish(event.target.value)} /></label>
            <label className={joinClasses(CLASS.modelingField, CLASS.modelingFieldWide)}>
              <Label>{studio.fields.prompt}</Label>
              <textarea className={joinClasses(CLASS.modelingControl, CLASS.modelingTextarea)} value={prompt} onChange={(event) => setPrompt(event.target.value)} />
            </label>
            <label className={joinClasses(CLASS.modelingField, CLASS.modelingFieldWide)}>
              <Label>{studio.fields.images}</Label>
              <input className={CLASS.modelingControl} type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => setImages(Array.from(event.target.files ?? []))} />
              <Copy className={CLASS.modelingHint}>{images.length ? `${images.length}장 선택됨 · 작업 완료 후 7일 보관` : "선택 사항 · JPEG/PNG/WebP 최대 4장, 각 10MB"}</Copy>
            </label>
          </Atom>
          <button className={CLASS.modelingButton} type="submit" disabled={pending}>{pending ? studio.pendingLabel : studio.submitLabel}</button>
          <Copy className={CLASS.modelingHint}>{progress || studio.unavailableMessage}</Copy>
        </form>
      </Surface>
      <Surface className={CLASS.modelingPreview}>
        <Atom className={CLASS.modelingToolbar}><Label>{studio.previewTitle}</Label><Link href="/">{studio.backLabel}</Link></Atom>
        <iframe className={CLASS.modelingFrame} title={studio.previewTitle} src={previewSrc} />
          <Atom className={joinClasses(CLASS.modelingResult, error && CLASS.modelingError)}>
            <Label>{studio.resultTitle}</Label>
            <Atom as={ELEMENT.span}>{error || result || studio.idleMessage}</Atom>
            {downloadReady && previewModel && <Link href={previewModel} download>{studio.downloadLabel}</Link>}
          </Atom>
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

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
import type { ElementType, ReactNode, RefObject } from "react";
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
          if (current?.sourceKey === sourceKey && current.texture.dataUrl === texture.dataUrl) return current;
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

function CatalogRegion({
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

import { Fragment, forwardRef } from "react";
import type { AnchorHTMLAttributes, CanvasHTMLAttributes, ComponentPropsWithoutRef, CSSProperties, ElementType, HTMLAttributes, ReactNode } from "react";
import { CLASS, ELEMENT, joinClasses } from "./tokens";
import type { KoreanSupplementLabelDefinition, ProductVisual as ProductVisualDefinition } from "./schema";

export function Atom<T extends ElementType = "div">({ as, ...props }: { as?: T } & Omit<ComponentPropsWithoutRef<T>, "as">) {
  const Tag = as ?? "div";
  return <Tag {...props} />;
}

export function Container<T extends ElementType = "div">({ as, className = "", ...props }: { as?: T; className?: string } & Omit<ComponentPropsWithoutRef<T>, "as" | "className">) {
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

export function Copy({ children, className = "" }: { children: ReactNode; className?: string }) { return <p className={className}>{children}</p>; }

export function Link({ children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) { return <a {...props}>{children}</a>; }
export function SiteHeader({ label, brand, brandHref, navigation, bagHref, bagLabel, bagCount, dot }: { label: string; brand: string; brandHref: string; navigation: readonly { label: string; href: string }[]; bagHref: string; bagLabel: string; bagCount: number; dot: string }){return <Container as={ELEMENT.nav} className={CLASS.nav} aria-label={label}><Link className={CLASS.brand} href={brandHref}>{brand}</Link><div>{navigation.map(item=><Link href={item.href} key={item.href}>{item.label}</Link>)}</div><Link className={CLASS.navBag} href={bagHref}>{bagLabel}{dot}{bagCount}</Link></Container>}
export function SiteFooter({ tagline, location }: { tagline: string; location: string }){return <Container as={ELEMENT.footer} className={CLASS.footer}><Copy>{tagline}</Copy><span>{location}</span></Container>}

export function LabeledChoice({code,name,detail,selected,onClick,className="",visual}:{code:string;name:string;detail:string;selected:boolean;onClick:()=>void;className?:string;visual?:ReactNode}){return <button className={joinClasses(CLASS.choice,className)} aria-pressed={selected} onClick={onClick}><span className={CLASS.choiceCode}>{code}</span>{visual&&<div className={CLASS.choiceVisual}>{visual}</div>}<div className={CLASS.choiceContent}><strong>{name}</strong><small>{detail}</small></div></button>}

export function SectionHeading({ label, title, copy }: { label: string; title: readonly string[]; copy: readonly string[] }) {
  return <header className={CLASS.sectionHead}><div><Label>{label}</Label><h2><Lines value={title}/></h2></div><p><Lines value={copy}/></p></header>;
}

export function Metric({ label, value, suffix }: { label: string; value: ReactNode; suffix?: string }) {
  return <GridCell className={CLASS.metric}><Label>{label}</Label><strong>{value}</strong>{suffix && <small>{suffix}</small>}</GridCell>;
}

export function Sticker({ label, children }: { label: string; children: ReactNode }) { return <div className={CLASS.labelSticker} aria-label={label}>{children}</div>; }
export function StickerSheet({ label, children }: { label: string; children: ReactNode }) { return <article className={joinClasses(CLASS.surface, CLASS.labelStickerSheet)} aria-label={label}>{children}</article>; }
export function StickerHeader({ badge, title, aside }: { badge: string; title: string; aside?: ReactNode }) {
  return <header className={CLASS.labelStickerHead}>
    {badge ? <span className={CLASS.labelStickerBadge}>{badge}</span> : null}
    <h3 className={CLASS.labelStickerTitle}>{title}</h3>
    {aside && <strong className={CLASS.labelStickerValue}>{aside}</strong>}
  </header>;
}
export function StickerSection({ title, children, collapsible = false }: { title?: string; children: ReactNode; collapsible?: boolean }) {
  if (title && collapsible) return <details className={CLASS.labelStickerSection}><summary className={CLASS.labelStickerSectionTitle}>{title}</summary>{children}</details>;
  return <section className={CLASS.labelStickerSection}>{title && <strong className={CLASS.labelStickerSectionTitle}>{title}</strong>}{children}</section>;
}
export function StickerRows({ children }: { children: ReactNode }) { return <div className={CLASS.labelStickerRows}>{children}</div>; }
export function StickerField({ label, value }: { label: string; value: ReactNode }) { return <div className={CLASS.labelStickerRow}><span className={CLASS.labelStickerField}>{label}</span><strong className={CLASS.labelStickerValue}>{value}</strong></div>; }
export function StickerCopy({ children }: { children: ReactNode }) { return <p className={CLASS.labelStickerCopy}>{children}</p>; }
export function StickerCostRows({ children }: { children: ReactNode }) { return <div className={CLASS.labelStickerCostRows}>{children}</div>; }
export function StickerCostHeader({ columns }: { columns: readonly string[] }) { return <div className={CLASS.labelStickerCostHeader}>{columns.map(column => <strong key={column}>{column}</strong>)}</div>; }
export function StickerCostRow({ name, meta, money, ratio, gaugeStart, gaugeSize, as = "div" }: { name: string; meta?: string; money: string; ratio: string; gaugeStart: number; gaugeSize: number; as?: "div" | "summary" }) {
  const Tag = as;
  return <Tag className={CLASS.labelStickerCostRow}><strong className={CLASS.labelStickerCostName}>{name}</strong><span className={CLASS.labelStickerCostMeta}>{meta}</span><i className={CLASS.labelStickerCostGauge}><b style={{ left: `${gaugeStart}%`, width: `${gaugeSize}%` }}/></i><strong className={CLASS.labelStickerCostAmount}>{money}</strong><span>{ratio}</span></Tag>;
}
export function StickerCostGroup({ name, meta, money, ratio, gaugeStart, gaugeSize, children }: { name: string; meta?: string; money: string; ratio: string; gaugeStart: number; gaugeSize: number; children?: ReactNode }) {
  if (children) return <details className={CLASS.labelStickerCostDetail}><StickerCostRow as="summary" name={name} meta={meta} money={money} ratio={ratio} gaugeStart={gaugeStart} gaugeSize={gaugeSize}/><div className={CLASS.labelStickerCostSummary}>{children}</div></details>;
  return <div className={CLASS.labelStickerCostDetail}><StickerCostRow name={name} meta={meta} money={money} ratio={ratio} gaugeStart={gaugeStart} gaugeSize={gaugeSize}/></div>;
}

export function KoreanSupplementLabel({ definition, locale, currencyMark, percentMark }: { definition: KoreanSupplementLabelDefinition; locale: string; currencyMark: string; percentMark: string }) {
  const money = (value: number) => `${currencyMark}${value.toLocaleString(locale)}`;
  const ratio = (value: number, precision = 1) => `${(value / definition.consumerPrice * 100).toFixed(precision)}${percentMark}`;
  const ingredientTotal = definition.ingredients.reduce((sum, item) => sum + item.cost, 0);
  const costTotal = definition.costs.reduce((sum, item) => sum + item.amount, 0);
  const displayedTotal = ingredientTotal + costTotal;
  const renderField = (field: { label: string; value: string }) => <StickerField label={field.label} value={field.value} key={`${field.label}-${field.value}`}/>;
  let groupOffset = 0;
  const costGroups = definition.costGroups.map(group => {
    const items = group.id === "ingredient"
      ? definition.ingredients.map(item => ({ id: item.id, name: item.name, meta: item.amount, value: item.cost }))
      : definition.costs.filter(item => item.group === group.id).map(item => ({ id: item.id, name: item.label, meta: "", value: item.amount }));
    const total = items.reduce((sum, item) => sum + item.value, 0);
    const start = groupOffset;
    const size = total / definition.consumerPrice * 100;
    groupOffset += size;
    let childOffset = start;
    const children = items.map(item => {
      const childSize = item.value / definition.consumerPrice * 100;
      const row = <StickerCostRow name={item.name} meta={item.meta} money={money(item.value)} ratio={ratio(item.value)} gaugeStart={childOffset} gaugeSize={childSize} key={item.id}/>;
      childOffset += childSize;
      return row;
    });
    const hasChildren = items.length > 1;
    return <StickerCostGroup name={group.label} meta={hasChildren ? `${items.length.toLocaleString(locale)}개 세부 항목` : undefined} money={money(total)} ratio={ratio(total, group.id === "profit" ? 2 : 1)} gaugeStart={start} gaugeSize={size} key={group.id}>{hasChildren ? <StickerCostRows>{children}</StickerCostRows> : undefined}</StickerCostGroup>;
  });
  return <Sticker label={definition.title}>
    <StickerSheet label={definition.title}>
      <StickerHeader badge={definition.badge} title={definition.title}/>
      <StickerSection><StickerRows>{definition.identification.map(renderField)}</StickerRows></StickerSection>
      {definition.sections.map(section => <StickerSection title={section.title} collapsible key={section.id}>{section.fields && <StickerRows>{section.fields.map(renderField)}</StickerRows>}{section.copy?.map(line => <StickerCopy key={line}>{line}</StickerCopy>)}</StickerSection>)}
      <StickerSection title={definition.ingredientsTitle} collapsible><StickerCopy>{definition.ingredients.map(item => `${item.name}(${item.amount})`).join(", ")}</StickerCopy></StickerSection>
      {definition.notices.length > 0 && <StickerSection>{definition.notices.map(line => <StickerCopy key={line}>{line}</StickerCopy>)}</StickerSection>}
    </StickerSheet>
    <StickerSheet label={definition.costsTitle}>
      <StickerHeader badge={definition.badge} title={definition.costsTitle} aside={money(displayedTotal)}/>
      <StickerSection><StickerCostHeader columns={definition.costColumns}/><StickerCostRows>{costGroups}</StickerCostRows></StickerSection>
    </StickerSheet>
  </Sticker>;
}

export function TeeSilhouette({ compact = false, variant = "crew" }: { compact?: boolean; variant?: "crew" | "relaxed" | "pocket" }) {
  const variantClass = variant === "relaxed" ? CLASS.teeRelaxed : variant === "pocket" ? CLASS.teePocket : undefined;
  return <div className={joinClasses(CLASS.tee, variantClass, compact && CLASS.teeCompact)} aria-hidden="true"><i/>{variant === "pocket" && <b/>}</div>;
}

export function ProductVisual({ visual, compact = false }: { visual: ProductVisualDefinition; compact?: boolean }) {
  return visual.kind === "image" ? <Atom as={ELEMENT.image} className={CLASS.productImage} data-compact={compact} src={visual.src} alt={visual.alt}/> : <TeeSilhouette compact={compact} variant={visual.variant}/>;
}

export function GlobeRoot(props: HTMLAttributes<HTMLDivElement>) { return <div className={CLASS.globe} {...props}/>; }
export const GlobeInteraction = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function GlobeInteraction(props, ref) { return <div ref={ref} className={CLASS.globeInteraction} {...props}/>; });
export const GlobeCanvas = forwardRef<HTMLCanvasElement, CanvasHTMLAttributes<HTMLCanvasElement>>(function GlobeCanvas(props, ref) { return <canvas ref={ref} {...props}/>; });
export function GlobeOverlay({ kind, anchor, opacity, children }: { kind: "node" | "cost"; anchor: string; opacity: string; children: ReactNode }) {
  return <div className={kind === "node" ? CLASS.globeNode : CLASS.globeCost} style={{ positionAnchor: anchor, opacity } as CSSProperties}>{children}</div>;
}

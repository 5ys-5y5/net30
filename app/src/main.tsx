import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Storefront } from "../../docs/design-system/entry";
import { ApplicationErrorBoundary, Copy, Surface } from "../../docs/design-system";
import "../../docs/design-system/styles.css";
import "../../docs/design-system/typography.css";
import "../../docs/design-system/hero.css";
import "../../docs/design-system/catalog.css";
import "../../docs/design-system/label-sticker.css";
import { modelPageDefinition } from "./modeling-studio/model-definition";
import { net30Definition } from "./sku-data";

const pathname = window.location.pathname.replace(/\/+$/, "") || "/";
const definition = pathname === "/model" ? modelPageDefinition : net30Definition;

document.documentElement.lang = definition.system.language;
document.title = definition.meta.title;

const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
if (description) description.content = definition.meta.description;
else {
  const meta = document.createElement("meta");
  meta.name = "description";
  meta.content = definition.meta.description;
  document.head.append(meta);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ApplicationErrorBoundary fallback={<Surface role="alert"><Copy>화면을 표시하는 중 오류가 발생했습니다. 페이지를 새로고침해 다시 시도하세요.</Copy></Surface>}>
      <Storefront definition={definition} />
    </ApplicationErrorBoundary>
  </StrictMode>,
);

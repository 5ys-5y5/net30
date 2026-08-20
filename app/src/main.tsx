import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Storefront } from "../../docs/design-system/entry";
import "../../docs/design-system/styles.css";
import "../../docs/design-system/typography.css";
import "../../docs/design-system/hero.css";
import "../../docs/design-system/catalog.css";
import "../../docs/design-system/label-sticker.css";
import "./modeling-studio/model-page.css";
import { net30Definition } from "./sku-data";
import { ModelPage } from "./modeling-studio/ModelPage";

document.documentElement.lang = net30Definition.system.language;
document.title = net30Definition.meta.title;

const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
if (description) description.content = net30Definition.meta.description;
else {
  const meta = document.createElement("meta");
  meta.name = "description";
  meta.content = net30Definition.meta.description;
  document.head.append(meta);
}

const path = typeof window === "undefined" ? "/" : window.location.pathname;
const isModelPage = path === "/model" || path === "/model/";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {isModelPage ? <ModelPage definition={net30Definition} /> : <Storefront definition={net30Definition} />}
  </StrictMode>,
);

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Storefront } from "../../docs/design-system/entry";
import "../../docs/design-system/styles.css";
import "../../docs/design-system/typography.css";
import "../../docs/design-system/hero.css";
import "../../docs/design-system/catalog.css";
import "../../docs/design-system/label-sticker.css";
import { net30Definition } from "./sku-data";

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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Storefront definition={net30Definition} />
  </StrictMode>,
);

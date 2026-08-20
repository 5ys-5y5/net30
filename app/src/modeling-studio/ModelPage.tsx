import { useMemo, useState } from "react";
import type { ProductPageDefinition } from "../../../docs/design-system/schema";

type ComponentKey = "bottle" | "cap" | "labelFront" | "labelBack" | "vitamin" | "physicsCollider";
type MaterialKey = "glass" | "opaque-plastic" | "paper" | "capsule" | "tablet" | "softgel" | "custom";
type ShapeKey = "reference-match" | "cylindrical" | "short-wide" | "tall-slim" | "ribbed" | "custom";

interface RequestPayload {
  component: ComponentKey;
  prompt: string;
  settings: {
    widthMm: number;
    heightMm: number;
    depthMm: number;
    thicknessMm: number;
    distortion: number;
    material: MaterialKey;
    shape: ShapeKey;
    color: string;
    finish: string;
    presetSkuId: string;
  };
}

const MODELING_HUB_URL = import.meta.env.VITE_NET30_MODELING_HUB_URL ?? "";
const SERVICE_ORIGIN = import.meta.env.VITE_NET30_3D_SERVICE_URL ?? "/3d";

function deriveSkuIds(definition: ProductPageDefinition): string[] {
  const ids = new Set<string>();
  const candidateBlocks = ((definition as any)?.catalog?.blocks ?? []) as any[];
  for (const block of candidateBlocks) {
    const cards = Array.isArray(block?.cards) ? block.cards : [];
    for (const card of cards) {
      if (typeof card?.id === "string" && card.id) ids.add(card.id);
      if (typeof card?.skuId === "string" && card.skuId) ids.add(card.skuId);
    }
  }
  return ids.size ? [...ids] : ["default-sku"];
}

export function ModelPage({ definition }: { definition: ProductPageDefinition }) {
  const skuIds = useMemo(() => deriveSkuIds(definition), [definition]);
  const [component, setComponent] = useState<ComponentKey>("bottle");
  const [material, setMaterial] = useState<MaterialKey>("glass");
  const [shape, setShape] = useState<ShapeKey>("reference-match");
  const [widthMm, setWidthMm] = useState(45);
  const [heightMm, setHeightMm] = useState(92);
  const [depthMm, setDepthMm] = useState(45);
  const [thicknessMm, setThicknessMm] = useState(2.5);
  const [distortion, setDistortion] = useState(0.12);
  const [color, setColor] = useState("#2d5fc4");
  const [finish, setFinish] = useState("high-gloss");
  const [skuId, setSkuId] = useState(skuIds[0]);
  const [prompt, setPrompt] = useState(
    "기준 사진과 최대한 일치하도록 이 컴포넌트를 수정하세요. 형상, 비율, 재질, 두께, 왜곡을 우선적으로 보정하세요.",
  );
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [previewSeed, setPreviewSeed] = useState(() => Date.now().toString());

  async function submit() {
    setPending(true);
    setError("");
    setResult("");

    const payload: RequestPayload = {
      component,
      prompt,
      settings: {
        widthMm,
        heightMm,
        depthMm,
        thicknessMm,
        distortion,
        material,
        shape,
        color,
        finish,
        presetSkuId: skuId,
      },
    };

    try {
      const response = await fetch(`${MODELING_HUB_URL}/api/modeling/jobs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const body = (await response.json()) as {
        ok: boolean;
        summary?: string;
        error?: string;
        exportPaths?: { renderGlb: string; physicsGlb: string; vitaminGlb: string };
      };

      if (!response.ok || !body.ok) {
        throw new Error(body.error ?? `모델링 요청 실패 (${response.status})`);
      }

      setResult([
        body.summary ?? "요약 없음",
        body.exportPaths ? `render: ${body.exportPaths.renderGlb}` : "",
        body.exportPaths ? `physics: ${body.exportPaths.physicsGlb}` : "",
        body.exportPaths ? `vitamins: ${body.exportPaths.vitaminGlb}` : "",
      ].filter(Boolean).join("\n"));
      setPreviewSeed(Date.now().toString());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  const previewUrl = `${SERVICE_ORIGIN}/?hostOrigin=${encodeURIComponent(window.location.origin)}&qa=reference&refresh=${previewSeed}`;

  return (
    <main className="net30-model-page">
      <header className="net30-model-page__header">
        <div>
          <p className="net30-model-page__eyebrow">NET30 3D Modeling Studio</p>
          <h1>OpenAI + Blender MCP 모델링 제어</h1>
          <p>
            /model 페이지에서 컴포넌트별 프롬프트와 기본 조형 파라미터를 바꾸고,
            OpenAI API 기반 LLM이 Blender MCP를 통해 .blend 원본을 수정합니다.
          </p>
        </div>
        <a className="net30-model-page__back" href="/">Storefront로 돌아가기</a>
      </header>

      <section className="net30-model-page__grid">
        <form className="net30-model-card" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <h2>모델링 지시</h2>

          <label>
            <span>컴포넌트</span>
            <select value={component} onChange={(event) => setComponent(event.target.value as ComponentKey)}>
              <option value="bottle">유리병</option>
              <option value="cap">뚜껑</option>
              <option value="labelFront">전면 라벨</option>
              <option value="labelBack">후면 라벨</option>
              <option value="vitamin">알약</option>
              <option value="physicsCollider">물리 콜라이더</option>
            </select>
          </label>

          <label>
            <span>SKU</span>
            <select value={skuId} onChange={(event) => setSkuId(event.target.value)}>
              {skuIds.map((id) => <option value={id} key={id}>{id}</option>)}
            </select>
          </label>

          <div className="net30-model-page__two-up">
            <label>
              <span>재질</span>
              <select value={material} onChange={(event) => setMaterial(event.target.value as MaterialKey)}>
                <option value="glass">glass</option>
                <option value="opaque-plastic">opaque-plastic</option>
                <option value="paper">paper</option>
                <option value="capsule">capsule</option>
                <option value="tablet">tablet</option>
                <option value="softgel">softgel</option>
                <option value="custom">custom</option>
              </select>
            </label>
            <label>
              <span>형상</span>
              <select value={shape} onChange={(event) => setShape(event.target.value as ShapeKey)}>
                <option value="reference-match">reference-match</option>
                <option value="cylindrical">cylindrical</option>
                <option value="short-wide">short-wide</option>
                <option value="tall-slim">tall-slim</option>
                <option value="ribbed">ribbed</option>
                <option value="custom">custom</option>
              </select>
            </label>
          </div>

          <div className="net30-model-page__two-up">
            <label><span>폭(mm)</span><input type="number" value={widthMm} onChange={(e) => setWidthMm(Number(e.target.value))} /></label>
            <label><span>높이(mm)</span><input type="number" value={heightMm} onChange={(e) => setHeightMm(Number(e.target.value))} /></label>
          </div>
          <div className="net30-model-page__two-up">
            <label><span>깊이(mm)</span><input type="number" value={depthMm} onChange={(e) => setDepthMm(Number(e.target.value))} /></label>
            <label><span>두께(mm)</span><input type="number" step="0.1" value={thicknessMm} onChange={(e) => setThicknessMm(Number(e.target.value))} /></label>
          </div>
          <div className="net30-model-page__two-up">
            <label><span>왜곡 정도</span><input type="number" step="0.01" value={distortion} onChange={(e) => setDistortion(Number(e.target.value))} /></label>
            <label><span>마감</span><input type="text" value={finish} onChange={(e) => setFinish(e.target.value)} /></label>
          </div>
          <label>
            <span>대표 색상</span>
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
          </label>
          <label>
            <span>모델링 프롬프트</span>
            <textarea rows={10} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          </label>
          <button type="submit" disabled={pending}>{pending ? "모델링 실행 중..." : "OpenAI + Blender MCP 실행"}</button>
          <p className="net30-model-page__hint">OPENAI_API_KEY는 modeling-hub 서비스의 .env에서 읽습니다.</p>
        </form>

        <aside className="net30-model-card">
          <h2>실시간 미리보기</h2>
          <iframe className="net30-model-page__preview" title="3D preview" src={previewUrl} />
          <div className="net30-model-page__result">
            <h3>최근 작업 결과</h3>
            {error ? <pre className="net30-model-page__error">{error}</pre> : null}
            {result ? <pre>{result}</pre> : <p>아직 실행 기록이 없습니다.</p>}
          </div>
        </aside>
      </section>
    </main>
  );
}

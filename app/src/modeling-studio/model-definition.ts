import type { ProductPageDefinition } from "../../../docs/design-system/entry";
import { net30Definition } from "../sku-data";

const serviceOrigin = import.meta.env.VITE_NET30_3D_SERVICE_URL ?? "/3d";
const embeddedHostOrigin = typeof window === "undefined" ? "" : `&hostOrigin=${encodeURIComponent(window.location.origin)}`;

export const modelPageDefinition: ProductPageDefinition = {
  ...net30Definition,
  regions: ["header", "catalog", "footer"],
  meta: {
    title: "NET30 — 3D 모델링 스튜디오",
    description: "Blender MCP를 사용해 NET30 제품 3D 자산을 컴포넌트별로 관리합니다.",
  },
  system: {
    ...net30Definition.system,
    topId: net30Definition.system.catalogId,
  },
  brand: {
    ...net30Definition.brand,
    tagline: "제품 데이터와 Blender 원본을 분리한 3D 자산 관리",
  },
  navigation: [],
  catalogSection: {
    label: "3D MODELING STUDIO",
    title: ["프롬프트와 이미지로", "3D 자산을 생성합니다."],
    copy: [
      "텍스트 지시와 선택적 이미지 입력을 OpenAI가 구조화하고, 검증된 Blender 파이프라인이 런타임 GLB로 내보냅니다.",
    ],
  },
  catalog: {
    ...net30Definition.catalog,
    presentation: "modeling",
    modeling: {
      endpoint: "/api/modeling/jobs",
      previewSrc: `${serviceOrigin}/?${embeddedHostOrigin.slice(1)}`,
      downloadSrc: `${serviceOrigin}/models/showcase-vial.glb`,
      title: "OpenAI × Blender",
      copy: "이미지는 선택적 모델링 입력입니다. OpenAI가 안전한 구조 명세를 만들고 headless Blender가 GLB를 생성합니다.",
      backLabel: "Storefront로 돌아가기",
      submitLabel: "모델링 실행",
      pendingLabel: "모델링 작업 진행 중",
      previewTitle: "3D 미리보기",
      resultTitle: "최근 실행 결과",
      downloadLabel: "현재 GLB 다운로드",
      idleMessage: "아직 실행한 모델링 작업이 없습니다.",
      unavailableMessage: "모델링 서비스가 일시적으로 준비되지 않아도, 저장된 3D 자산 미리보기는 계속 표시됩니다.",
      fields: {
        model: "OpenAI 모델",
        images: "모델링 입력 이미지",
        component: "컴포넌트",
        sku: "SKU",
        material: "재질",
        shape: "형상",
        sizeXmm: "폭(mm)",
        sizeYmm: "높이(mm)",
        sizeZmm: "깊이(mm)",
        shellThicknessMm: "두께(mm)",
        distortion: "왜곡 정도",
        tone: "대표 색상",
        finish: "마감",
        prompt: "모델링 프롬프트",
      },
      components: [
        { id: "bottle", label: "유리병" },
        { id: "cap", label: "뚜껑" },
        { id: "labelFront", label: "전면 라벨" },
        { id: "labelBack", label: "후면 라벨" },
        { id: "vitamin", label: "알약" },
        { id: "physicsCollider", label: "물리 콜라이더" },
      ],
      materials: [
        { id: "glass", label: "유리" },
        { id: "opaque-plastic", label: "불투명 플라스틱" },
        { id: "paper", label: "종이 라벨" },
        { id: "tablet", label: "정제" },
        { id: "capsule", label: "캡슐" },
        { id: "softgel", label: "소프트젤" },
        { id: "custom", label: "사용자 정의" },
      ],
      shapes: [
        { id: "cylindrical", label: "원통형" },
        { id: "short-wide", label: "짧고 넓은 형상" },
        { id: "tall-slim", label: "길고 좁은 형상" },
        { id: "ribbed", label: "리브형" },
        { id: "custom", label: "사용자 정의" },
      ],
      defaults: {
        modelId: "",
        componentId: "bottle",
        materialId: "glass",
        shapeId: "cylindrical",
        sizeXmm: 45,
        sizeYmm: 92,
        sizeZmm: 45,
        shellThicknessMm: 2.5,
        distortion: 0.12,
        tone: "#2d5fc4",
        finish: "high-gloss",
        prompt: "투명한 유리병, 짙은 파란 리브 캡, 크림색 전면 라벨을 가진 정교한 건강보조제 패키지를 생성하세요. 부드러운 숄더, 실제 벽 두께, 깨끗한 PBR 재질을 사용하세요.",
      },
    },
  },
};

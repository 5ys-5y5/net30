import type { ProductPageDefinition } from "../../../docs/design-system/entry";
import { net30Definition } from "../sku-data";

const serviceOrigin = import.meta.env.VITE_NET30_3D_SERVICE_URL ?? "/3d";

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
    title: ["컴포넌트를 선택하고", "Blender 원본을 수정합니다."],
    copy: [
      "유리병, 뚜껑, 전·후면 라벨, 비타민과 물리 콜라이더를 제품 데이터와 독립적으로 관리합니다.",
    ],
  },
  catalog: {
    ...net30Definition.catalog,
    presentation: "modeling",
    modeling: {
      endpoint: "/api/modeling/jobs",
      previewSrc: `${serviceOrigin}/?qa=reference`,
      title: "Blender MCP",
      copy: "모델링 프롬프트와 값은 headless Blender MCP로 전달되며, 생성된 GLB는 Blender 없이도 Storefront에서 실행됩니다.",
      backLabel: "Storefront로 돌아가기",
      submitLabel: "모델링 실행",
      pendingLabel: "Blender 작업 실행 중",
      previewTitle: "3D 미리보기",
      resultTitle: "최근 실행 결과",
      idleMessage: "아직 실행한 모델링 작업이 없습니다.",
      unavailableMessage: "모델링 서비스가 일시적으로 준비되지 않아도, 저장된 3D 자산 미리보기는 계속 표시됩니다.",
      fields: {
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
        { id: "reference-match", label: "기준 사진 일치" },
        { id: "cylindrical", label: "원통형" },
        { id: "short-wide", label: "짧고 넓은 형상" },
        { id: "tall-slim", label: "길고 좁은 형상" },
        { id: "ribbed", label: "리브형" },
        { id: "custom", label: "사용자 정의" },
      ],
      defaults: {
        componentId: "bottle",
        materialId: "glass",
        shapeId: "reference-match",
        sizeXmm: 45,
        sizeYmm: 92,
        sizeZmm: 45,
        shellThicknessMm: 2.5,
        distortion: 0.12,
        tone: "#2d5fc4",
        finish: "high-gloss",
        prompt: "기준 사진과 최대한 일치하도록 선택한 컴포넌트의 형상, 비율, 재질, 두께와 왜곡을 보정하세요.",
      },
    },
  },
};

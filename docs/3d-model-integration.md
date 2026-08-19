# NET30 3D 비타민 병 통합 구조

## 1. 저장소 구조

기존 저장소의 `app/`과 `docs/` 구조 안에서만 관리합니다. 제품 정보와 SKU 조립은 `app/src/sku-data.ts` 하나가 담당하고, `pricing-model.ts`는 가격 계산 규칙만 담당합니다.

```text
app/
├─ src/
│  ├─ landing-copy.ts
│  ├─ main.tsx
│  ├─ pricing-model.ts
│  └─ sku-data.ts
└─ public/
   └─ assets/
      └─ 3d/
         └─ vitamin-bottle/
            ├─ README.md
            ├─ model/
            │  ├─ config.js
            │  ├─ geometry.js
            │  ├─ label-texture.js
            │  ├─ math.js
            │  ├─ shaders.js
            │  └─ vitamin-bottle-model.js
            ├─ shared/
            │  ├─ camera-controls.js
            │  └─ sku-bridge.js
            ├─ editor/
            │  ├─ editor.css
            │  ├─ editor.js
            │  └─ index.html
            └─ output/
               ├─ index.html
               ├─ viewer.css
               └─ viewer.js
docs/
├─ design-system/
│  └─ render-label-texture.ts
├─ 3d-file-manifest.txt
├─ 3d-model-integration.md
└─ 3d-validation.md
```

## 2. 제품 정보의 단일 원천

`app/src/sku-data.ts`에서 다음 내용을 한 번에 관리합니다.

- 제품 형태와 3D 출력 주소
- 생산 배치와 OEM 비용
- 원료명, 함량, 원가
- 생산·유통·마케팅·운영 비용
- 한글표시사항
- 가격 구조
- SKU 조합과 `net30Definition`

`app/src/main.tsx`는 다음 한 경로만 사용합니다.

```ts
import { net30Definition } from "./sku-data";
```

## 3. 웹 라벨과 3D 라벨의 동일성

3D 모델용 라벨을 별도 문자열 배열이나 별도 레이아웃으로 만들지 않습니다. Storefront에 실제 렌더링된 `.ds-label-sticker` 루트에서 다음 두 시트를 확인하고, 계산된 스타일을 포함한 현재 DOM을 하나의 PNG 텍스처로 캡처합니다.

```text
.ds-surface.ds-label-sticker-sheet[aria-label="한글표시사항"]
.ds-surface.ds-label-sticker-sheet[aria-label="전체 가격 구조"]
```

캡처는 현재 화면의 다음 상태를 그대로 반영합니다.

- 선택된 SKU 데이터
- 실제 CSS 레이아웃과 폰트 속성
- 반응형 너비
- `<details>` 열림·닫힘 상태
- 게이지, 가격, 비율, 구분선과 여백

캡처한 PNG는 `NET30_LABEL_DATA` 메시지로 iframe에 전달되고, `shared/sku-bridge.js`가 두 시트의 이름·크기·형식을 검증한 뒤 WebGL 텍스처로 적용합니다. 텍스처 비율에 맞춰 병 라벨의 물리적 높이도 자동 조정합니다.

## 4. 실행 경로

- 상품 출력: `/assets/3d/vitamin-bottle/output/index.html`
- 편집 화면: `/assets/3d/vitamin-bottle/editor/index.html`

```bash
cd /Users/gy/Documents/dev/net30/app
npm install
npm run dev
```

ES module을 사용하므로 Vite 개발 서버 또는 HTTP 서버에서 실행합니다.

## 5. 파일별 책임

- 제품·SKU·표시사항 변경: `app/src/sku-data.ts`
- 가격 공식 변경: `app/src/pricing-model.ts`
- 실제 DOM 캡처: `docs/design-system/render-label-texture.ts`
- Storefront와 iframe 연결: `docs/design-system/Storefront.tsx`, `docs/design-system/index.tsx`
- payload 검증: `shared/sku-bridge.js`
- 텍스처 적용: `model/label-texture.js`
- 병 형상과 재질: `model/geometry.js`, `model/vitamin-bottle-model.js`, `model/shaders.js`
- 로컬 모델 편집: `editor/`
- 실제 상품 노출: `output/`

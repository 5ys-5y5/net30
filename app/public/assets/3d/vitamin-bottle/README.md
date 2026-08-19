# NET30 Vitamin Bottle Web 3D Asset

이 디렉터리는 기존 `net30/app/public` 아래에 추가되는 정적 3D 자산입니다. 새로운 애플리케이션 루트나 별도 빌드 시스템을 만들지 않습니다.

## 디렉터리 책임

- `model/`: WebGL 렌더러, 병 형상, 셰이더, 라벨 텍스처 생성 등 재사용 가능한 모델 코드
- `shared/`: 모델과 출력·편집 화면이 함께 사용하는 카메라 조작 및 SKU 메시지 브리지
- `editor/`: 뚜껑, 유리, 비타민, 라벨과 배치를 변경하고 JSON/PNG를 내보내는 작업 화면
- `output/`: Storefront의 iframe이 실제로 로드하는 배포 화면
- `textures/`: 제공된 가격 구조 이미지 같은 원본 텍스처

## 실행 경로

- 실제 상품 출력: `/assets/3d/vitamin-bottle/output/index.html`
- 편집 도구: `/assets/3d/vitamin-bottle/editor/index.html`
- 기존 주소 호환: `/vitamin_bottle_3d_editor.html`

## SKU 데이터 흐름

`pricing-model.ts` → `sku-data.ts` → `product-definition.ts` → `Storefront` → `NET30_LABEL_DATA` → `output/index.html` → `model/vitamin-bottle-model.js`

라벨은 Storefront에서 선택한 SKU에 따라 `brand`, `productName`, `dose`, `quantity`, 한글 표시사항 및 가격 구조를 다시 그립니다. 뚜껑 등 모델 외형은 편집기에서 독립적으로 변경할 수 있으며, 필요 시 메시지 payload의 선택적 `model` 객체로도 전달할 수 있습니다.

## 변경 원칙

- 가격·원료·배치 계산값은 `app/src/sku-data.ts`와 `app/src/pricing-model.ts`를 단일 원천으로 사용합니다.
- `output/`에는 편집 UI를 넣지 않습니다.
- `editor/`는 모델 내부 구현을 복제하지 않고 `model/`을 import합니다.
- 텍스처 파일은 JS에 base64로 내장하지 않습니다.

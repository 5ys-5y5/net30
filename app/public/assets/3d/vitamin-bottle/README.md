# NET30 Vitamin Bottle Web 3D Asset

이 디렉터리는 기존 `app/public/assets/3d/vitamin-bottle` 안에서 모델, 편집기, 실제 출력 화면을 분리해 관리합니다. 별도 애플리케이션 루트나 독립 빌드 시스템은 만들지 않습니다.

## 디렉터리 책임

- `model/`: WebGL 렌더러, 병 형상, 셰이더, 라벨 텍스처 적용
- `shared/`: 카메라 조작과 Storefront↔iframe 메시지 브리지
- `editor/`: 뚜껑·유리·비타민·로컬 라벨과 배치를 수정하는 작업 화면
- `output/`: Storefront가 iframe으로 불러오는 실제 상품 출력 화면

## 실행 경로

- 실제 상품 출력: `/assets/3d/vitamin-bottle/output/index.html`
- 편집 도구: `/assets/3d/vitamin-bottle/editor/index.html`

## SKU와 라벨 데이터 흐름

`pricing-model.ts` → `sku-data.ts` → `Storefront` → 실제 `ds-label-sticker` DOM 캡처 → `NET30_LABEL_DATA` → `output/` → `model/`

제품 원료, 생산 배치, 가격, 한글표시사항, `net30Definition`은 `app/src/sku-data.ts` 한 파일에서 조립됩니다. `pricing-model.ts`는 가격 계산 규칙만 담당합니다.

3D SKU 라벨은 문자열을 별도 레이아웃으로 다시 그리지 않습니다. Storefront에 실제 렌더링된 다음 두 요소를 그대로 PNG 텍스처로 캡처합니다.

- `.ds-surface.ds-label-sticker-sheet[aria-label="한글표시사항"]`
- `.ds-surface.ds-label-sticker-sheet[aria-label="전체 가격 구조"]`

SKU 변경, 화면 크기 변경, `<details>` 열림 상태 변경이 발생하면 동일 DOM을 다시 캡처해 3D 모델에 전달합니다.

## 변경 원칙

- 제품 정보의 단일 원천은 `app/src/sku-data.ts`입니다.
- `output/`은 편집 UI나 라벨 재구성 로직을 포함하지 않습니다.
- `editor/`는 모델 코드를 복제하지 않고 `model/`을 import합니다.
- Storefront 라벨은 실제 디자인 시스템 DOM 캡처만 허용합니다.
- 단일 HTML 호환 파일이나 정적 라벨 텍스처를 유지하지 않습니다.

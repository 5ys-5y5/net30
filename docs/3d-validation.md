# NET30 3D 라벨 검증 기준

## 정적 검사

- `model/`, `shared/`, `editor/`, `output/`의 모든 JavaScript 파일을 `node --check`로 검사합니다.
- `app/src/sku-data.ts` 한 파일에서 제품 데이터와 `net30Definition`을 함께 내보내는지 확인합니다.
- `app/src/main.tsx`가 `./sku-data`만 가져오는지 확인합니다.
- 제품 고유 표시사항이 3D 모델 설정 파일에 중복 저장되지 않았는지 확인합니다.
- 두 라벨 시트를 문자열 배열로 재조립하는 코드가 실제 3D 런타임 경로에 남아 있지 않은지 확인합니다.

## TypeScript 생성 파일 정책

- 타입 검사는 `tsc -p tsconfig.json --noEmit`으로 실행합니다.
- 빌드 모드의 증분 메타데이터는 저장소에 추적하지 않습니다.
- `*.tsbuildinfo`는 `.gitignore`에서 제외하고, 빌드 후에도 작업 트리가 깨끗해야 합니다.
- `paths`는 `tsconfig.json` 기준 상대경로를 직접 사용하며 `baseUrl`은 사용하지 않습니다.

## DOM 캡처 검사

`render-label-texture.ts`는 다음 조건이 충족되지 않으면 캡처를 중단합니다.

1. 캡처 루트가 `.ds-label-sticker`여야 합니다.
2. `.ds-label-sticker-sheet`가 정확히 두 개여야 합니다.
3. 두 시트 모두 `.ds-surface`를 포함해야 합니다.
4. `aria-label`은 순서대로 `한글표시사항`, `전체 가격 구조`여야 합니다.
5. 캡처 대상의 실제 너비와 높이가 0보다 커야 합니다.

## 브라우저 통합 검사

Chromium에서 다음 흐름을 확인합니다.

1. 실제 두 시트 DOM을 계산된 스타일과 함께 PNG로 변환합니다.
2. PNG의 픽셀 크기와 두 `aria-label`을 payload에 포함합니다.
3. iframe이 동일 출처의 `NET30_LABEL_DATA`만 수신합니다.
4. payload 검증 후 모델 상태가 `rendered`로 전환됩니다.
5. WebGL 텍스처 캔버스 비율이 캡처 PNG 비율과 일치합니다.
6. 병 라벨의 물리적 높이가 텍스처 비율에 맞춰 조정됩니다.
7. SKU 또는 `<details>` 상태가 바뀌면 DOM을 다시 캡처합니다.

## 저장소 전체 검사

아래 검사는 괄호로 감싼 서브셸에서 실행합니다. 따라서 `set -u`와 `exit 1`이 사용자의 대화형 zsh 세션에 남지 않습니다.

```bash
(
  set -euo pipefail
  cd /Users/gy/Documents/dev/net30

  removed_paths=(
    app/public/vitamin_bottle_3d_editor.html
    docs/vitamin_bottle_3d_editor.html
    app/src/product-definition.ts
    app/public/assets/3d/vitamin-bottle/textures/price-structure-label.png
  )

  for path_to_check in "${removed_paths[@]}"; do
    if [ -e "$path_to_check" ]; then
      printf '검증 실패: 삭제 대상이 남아 있습니다: %s\n' "$path_to_check" >&2
      exit 1
    fi
  done

  grep -nF 'from "./sku-data"' app/src/main.tsx
  grep -nF 'export const net30Definition' app/src/sku-data.ts
  grep -nF 'const THREE_D_LABEL_SHEETS = ["한글표시사항", "전체 가격 구조"] as const;' docs/design-system/Storefront.tsx
  grep -nF 'const LABEL_SHEET_CLASS = "ds-label-sticker-sheet";' docs/design-system/render-label-texture.ts
  grep -nF '"typecheck": "tsc -p tsconfig.json --noEmit"' app/package.json

  if grep -nF '"baseUrl"' app/tsconfig.json; then
    echo '검증 실패: 더 이상 사용하지 않는 baseUrl 설정이 남아 있습니다.' >&2
    exit 1
  fi

  if git ls-files '*.tsbuildinfo' | grep -q .; then
    echo '검증 실패: TypeScript 증분 메타데이터가 Git에 추적되고 있습니다.' >&2
    git ls-files '*.tsbuildinfo' >&2
    exit 1
  fi

  if grep -RInE \
    --exclude-dir=node_modules \
    --exclude-dir=dist \
    'drawSkuLabel|koreanLabelLines|priceStructureLines|vitamin_bottle_3d_editor|price-structure-label|from[[:space:]]+["'"']\.\/product-definition["'"']' \
    app/src \
    app/public/assets/3d/vitamin-bottle \
    docs/design-system/Storefront.tsx \
    docs/design-system/index.tsx \
    docs/design-system/schema.ts \
    docs/design-system/render-label-texture.ts; then
    echo '검증 실패: 실제 런타임 경로에 제거 대상 코드가 남아 있습니다.' >&2
    exit 1
  fi

  find app/public/assets/3d/vitamin-bottle \
    -type f -name '*.js' -print0 \
    | xargs -0 -n1 node --check

  npm --prefix app run build
  git diff --check

  if [ -n "$(git status --porcelain)" ]; then
    echo '검증 실패: 빌드 후 작업 트리가 변경되었습니다.' >&2
    git status --short >&2
    exit 1
  fi

  echo 'NET30 3D 구조 검증 완료'
)
```

`docs/design-system/validation/`과 `template-map.mjs`에 등장하는 `product-definition`은 재사용 가능한 디자인 시스템의 일반 계약 및 테스트 픽스처 명칭입니다. 현재 NET30 제품 정보 파일이나 앱 런타임 import가 아니므로 3D 제품 통합 검사의 금지 대상에는 포함하지 않습니다.

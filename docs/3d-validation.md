# NET30 3D 라벨 검증 기준

## 정적 검사

- `model/`, `shared/`, `editor/`, `output/`의 모든 JavaScript 파일을 `node --check`로 검사합니다.
- `app/src/sku-data.ts` 한 파일에서 제품 데이터와 `net30Definition`을 함께 내보내는지 확인합니다.
- `app/src/main.tsx`가 `./sku-data`만 가져오는지 확인합니다.
- 제품 고유 표시사항이 3D 모델 설정 파일에 중복 저장되지 않았는지 확인합니다.
- 두 라벨 시트를 문자열 배열로 재조립하는 코드가 남아 있지 않은지 확인합니다.

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

```bash
cd /Users/gy/Documents/dev/net30
npm --prefix app run build
```

빌드 성공 후 `git diff --check`와 금지 문자열 검사를 함께 수행합니다.

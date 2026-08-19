import type { ProductPageDefinition } from "../../docs/design-system/entry";

export const landingCopy = {
  regions: ["header", "hero", "catalog", "principles", "footer"] as const,

  meta: {
    title: "NET30 — 멀티비타민 원가 표시사항",
    description: "멀티비타민 영양·기능성분과 소비자가격 전부를 공개합니다.",
  },

  system: {
    locale: "ko-KR",
    language: "ko",
    favicon: "/favicon.svg",
    topId: "top",
    catalogId: "receipt",
    traceId: "trace",
    principlesId: "principles",
  },

  brand: {
    name: "NET30",
    tagline: "소비자가 낸 금액을 빠짐없이 설명합니다.",
    location: "서울 · K2608 비타민 배치",
  },

  navigation: [
    { label: "한글표시사항", target: "catalog" },
    { label: "원료 경로", target: "trace" },
    { label: "공개 원칙", target: "principles" },
  ],

  labels: {
    primaryNavigation: "주요 메뉴",
    bag: "배치",
    currency: "원",
    currencyMark: "₩",
    percent: "%",
    dot: " · ",
    down: "↓",

    primaryChoice: "제품 선택",
    secondaryChoice: "생산 배치 선택",

    economics: "가격 구성",
    supplyRoute: "원료와 제조 경로",
    routeNode: "공급지",
    score: "원료비 비중",
    scoreSuffix: "%",
    scoreNote: "",
    routeAria: "원료와 제조 공급 경로",
    routeHint: "드래그해서 경로 확인",
    distance: "미분류 차액 0원",
    economicsNote: "",

    vat: "포함 부가가치세",
    platform: "결제·판매채널 수수료",
    landed: "공개 원가",
    contribution: "최종 판매가 기준 이익",
    contributionSuffix: "최종 판매가의 30%",
  },

  hero: {
    label: {
      lines: [{ text: "멀티비타민·미네랄 올인원" }],
    },
    heading: {
      lines: [{ text: "더 투명한 가격" }, { text: "더 합리적 소비", emphasis: true }],
    },
    copy: {
      lines: [{ text: "원료, 제조, 검사, 포장, 물류, 운영비, 이익, 포함 VAT를 모두 공개해요." }],
    },
    link: {
      lines: [{ text: "멀티비타민 표시사항 보기" }],
    },
    index: "가격 선택",
    range: "일반가 · 회원가 · 정기구독가",
    left: "가격 구조 전액 공개",
    right: "최종 판매가 대비 이익 30%",
  },

  catalogSection: {
    label: "제품에 실제로 붙는 정보",
    title: [],
    copy: [],
  },

  principlesSection: {
    label: "출고 전에 지키는 원칙",
    title: ["비용은 숨기거나 옮겨 담지 않고", "발생한 이름 그대로 적습니다."],
    copy: [
      "유료 마케팅비와 플랫폼 판매채널 수수료는 0원으로 유지합니다.",
      "실제 원가를 먼저 합산한 뒤 최종 판매가가 원가 + 이익 30% + 포함 VAT로 정확히 구성되도록 역산합니다.",
    ],
  },

  principles: [
    {
      code: "01 / 가격",
      title: "원가에서 최종 판매가 역산",
      copy: "원료·생산·유통·운영 원가를 합산하고, 최종 판매가의 30%를 이익으로 배분하며 포함 VAT를 분리 표시합니다.",
    },
    {
      code: "02 / 이익",
      title: "최종 판매가의 30%",
      copy: "원가가 바뀌면 최종 판매가와 이익 금액이 함께 다시 계산되며, 이익은 원 단위 반올림 범위에서 최종 판매가의 30%로 유지됩니다.",
    },
    {
      code: "03 / 법정정보",
      title: "한글표시사항 우선",
      copy: "제품명, 내용량, 기능정보, 섭취방법, 주의사항, 제조·판매 정보를 법정 표시 구조로 제공합니다.",
    },
    {
      code: "04 / 원가",
      title: "원료와 비용을 같은 줄에",
      copy: "기능성원료와 기타원료의 쓰임, 제품당 비용을 한 표에서 확인합니다.",
    },
  ],
} satisfies Omit<ProductPageDefinition, "catalog">;

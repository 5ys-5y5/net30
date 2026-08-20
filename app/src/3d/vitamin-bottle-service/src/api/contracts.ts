export const API_VERSION = "net30.3d.v1" as const;

export const HOST_MESSAGE_TYPE = {
  configure: `${API_VERSION}.configure`,
  labels: `${API_VERSION}.labels`,
  view: `${API_VERSION}.view`,
} as const;

export const SERVICE_MESSAGE_TYPE = {
  ready: `${API_VERSION}.ready`,
  configured: `${API_VERSION}.configured`,
  error: `${API_VERSION}.error`,
} as const;

export type LabelSurface = {
  readonly dataUrl: string;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly sourceLabel: "한글표시사항" | "전체 가격 구조";
};

export type VitaminShape = "round-tablet" | "caplet" | "softgel" | "capsule";

export type VitaminVariantConfig = {
  readonly id: string;
  readonly shape: VitaminShape;
  readonly count: number;
  readonly colors: readonly string[];
  readonly radius: number;
  readonly halfHeight: number;
  readonly mass: number;
  readonly friction: number;
  readonly restitution: number;
};

export type ProductConfig = {
  readonly skuId: string;
  readonly modelId?: "showcase-vial";
  readonly capColor?: string;
  readonly contents?: readonly VitaminVariantConfig[];
};

export type ConfigureMessage = {
  readonly type: typeof HOST_MESSAGE_TYPE.configure;
  readonly requestId: string;
  readonly payload: ProductConfig;
};

export type LabelsMessage = {
  readonly type: typeof HOST_MESSAGE_TYPE.labels;
  readonly requestId: string;
  readonly payload: {
    readonly skuId: string;
    readonly front: LabelSurface;
    readonly back: LabelSurface;
  };
};

export type ViewMessage = {
  readonly type: typeof HOST_MESSAGE_TYPE.view;
  readonly requestId: string;
  readonly payload: { readonly yaw?: number; readonly zoom?: number; readonly reset?: boolean };
};

export type HostToServiceMessage = ConfigureMessage | LabelsMessage | ViewMessage;

export type ServiceToHostMessage =
  | { readonly type: typeof SERVICE_MESSAGE_TYPE.ready; readonly payload: { readonly serviceVersion: string } }
  | { readonly type: typeof SERVICE_MESSAGE_TYPE.configured; readonly requestId: string; readonly payload: { readonly skuId: string } }
  | { readonly type: typeof SERVICE_MESSAGE_TYPE.error; readonly requestId?: string; readonly payload: { readonly message: string } };

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

export function isHostMessage(value: unknown): value is HostToServiceMessage {
  if (!isObject(value)) return false;
  const type = value.type;
  const requestId = value.requestId;
  if (typeof requestId !== "string" || !requestId.trim()) return false;
  return type === HOST_MESSAGE_TYPE.configure
    || type === HOST_MESSAGE_TYPE.labels
    || type === HOST_MESSAGE_TYPE.view;
}

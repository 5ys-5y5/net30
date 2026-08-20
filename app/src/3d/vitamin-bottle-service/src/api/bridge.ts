import {
  HOST_MESSAGE_TYPE,
  SERVICE_MESSAGE_TYPE,
  isHostMessage,
  type ConfigureMessage,
  type HostToServiceMessage,
  type LabelsMessage,
  type ServiceToHostMessage,
  type ViewMessage,
} from "./contracts";

export type BridgeHandlers = {
  readonly configure: (message: ConfigureMessage) => Promise<void> | void;
  readonly labels: (message: LabelsMessage) => Promise<void> | void;
  readonly view: (message: ViewMessage) => Promise<void> | void;
};

function requiredParentOrigin() {
  const value = new URLSearchParams(location.search).get("hostOrigin");
  if (window.parent !== window && !value) {
    throw new Error("embedded 3D service requires an explicit hostOrigin query parameter");
  }
  return value ?? window.location.origin;
}

function assertNever(message: never): never {
  throw new Error(`지원하지 않는 3D API 메시지입니다: ${JSON.stringify(message)}`);
}

function dispatchMessage(handlers: BridgeHandlers, message: HostToServiceMessage) {
  switch (message.type) {
    case HOST_MESSAGE_TYPE.configure:
      return handlers.configure(message);
    case HOST_MESSAGE_TYPE.labels:
      return handlers.labels(message);
    case HOST_MESSAGE_TYPE.view:
      return handlers.view(message);
    default:
      return assertNever(message);
  }
}

export function attachBridge(handlers: BridgeHandlers) {
  const allowedParentOrigin = requiredParentOrigin();
  const send = (message: ServiceToHostMessage) => {
    if (window.parent !== window) window.parent.postMessage(message, allowedParentOrigin);
  };

  const onMessage = (event: MessageEvent) => {
    if (event.source !== window.parent) return;
    if (event.origin !== allowedParentOrigin) return;
    if (!isHostMessage(event.data)) return;
    const message = event.data;
    Promise.resolve(dispatchMessage(handlers, message)).catch((error: unknown) => {
      send({
        type: SERVICE_MESSAGE_TYPE.error,
        requestId: message.requestId,
        payload: { message: error instanceof Error ? error.message : String(error) },
      });
    });
  };

  window.addEventListener("message", onMessage);
  send({ type: SERVICE_MESSAGE_TYPE.ready, payload: { serviceVersion: "0.1.1" } });
  return () => window.removeEventListener("message", onMessage);
}

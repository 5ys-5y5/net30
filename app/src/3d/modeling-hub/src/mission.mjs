const COMPONENT_INSTRUCTIONS = {
  bottle: [
    "유리병 외피와 내피를 기준 사진과 최대한 일치하도록 조정합니다.",
    "외피와 내피는 실제 두께를 가져야 하고 바닥은 더 두껍게 유지합니다.",
    "곡면은 긴 직선 세그먼트가 아니라 충분한 제어점이 있는 Bezier/NURBS 프로파일을 사용합니다.",
  ],
  cap: [
    "뚜껑은 완전 불투명한 파란 리브 캡으로 수정합니다.",
    "병 입구를 뒤에서 비쳐 보이게 하지 말고 충분히 가립니다.",
    "리브는 균일하고 실제 방사형 패턴을 가집니다.",
  ],
  labelFront: [
    "전면 라벨 전용 곡면 mesh를 조정합니다.",
    "전면 라벨은 다른 라벨과 연결하지 않습니다.",
    "런타임 texture를 얹기 위한 mesh와 UV를 정리합니다.",
  ],
  labelBack: [
    "후면 라벨 전용 곡면 mesh를 조정합니다.",
    "후면 라벨은 다른 라벨과 연결하지 않습니다.",
    "런타임 texture를 얹기 위한 mesh와 UV를 정리합니다.",
  ],
  vitamin: [
    "비타민 프로토타입 라이브러리를 갱신합니다.",
    "capsule / tablet / softgel / custom 중 요청에 맞는 형상을 수정합니다.",
    "InstancedMesh로 복제될 수 있도록 원점과 스케일을 정리합니다.",
  ],
  physicsCollider: [
    "물리 콜라이더를 수정합니다.",
    "렌더용 고폴리 모델을 재사용하지 말고 닫힌 저복잡도 collider를 유지합니다.",
    "병을 회전해도 비타민이 밖으로 새지 않도록 내부가 완전히 닫혀 있어야 합니다.",
  ],
};

export function buildMission({ component, prompt, settings, paths }) {
  const componentInstructions = COMPONENT_INSTRUCTIONS[component] ?? [];
  const dims = `width=${settings.widthMm}mm, height=${settings.heightMm}mm, depth=${settings.depthMm}mm, thickness=${settings.thicknessMm}mm`;
  return [
    "You are controlling Blender through the official Blender MCP server.",
    "Use the existing .blend file as the source of truth and modify only what is required.",
    `Target component: ${component}`,
    `Reference image path: ${paths.referenceImage}`,
    `Blend source path: ${paths.blendFile}`,
    `Render export path: ${paths.renderGlb}`,
    `Physics export path: ${paths.physicsGlb}`,
    `Vitamin export path: ${paths.vitaminGlb}`,
    `QA output directory: ${paths.qaDir}`,
    "Keep collections named RENDER_EXPORT, PHYSICS_EXPORT, VITAMIN_LIBRARY, and QA.",
    "If they do not exist, create them without renaming the runtime contract names.",
    ...componentInstructions,
    `Requested dimensions: ${dims}`,
    `Requested material: ${settings.material}`,
    `Requested shape: ${settings.shape}`,
    `Requested finish: ${settings.finish}`,
    `Representative color: ${settings.color}`,
    `Distortion intensity target: ${settings.distortion}`,
    "After editing, save the blend file, export render/physics/vitamin GLBs, render QA images, and report the exact output paths and a concise change summary.",
    "Prefer exact reference matching over stylistic freedom.",
    `User instruction: ${prompt}`,
  ].join("\n");
}

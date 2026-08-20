import fs from "node:fs/promises";
import path from "node:path";
import { executeBlenderModeling } from "./blender-mcp.mjs";
import { contractHash, createAssemblyContract, createComponentSpec, fallbackContract } from "./modeling-spec.mjs";

function assetRoot() { const value = process.env.NET30_3D_ASSET_ROOT?.trim(); if (!value) throw new Error("필수 환경변수가 없습니다: NET30_3D_ASSET_ROOT"); return value; }
export async function runModelingJob(payload, { jobId, imageInputs = [], onProgress = () => undefined } = {}) {
  const root = assetRoot(); const jobDir = path.join(root, "jobs", jobId); await fs.mkdir(path.join(jobDir, "reports"), { recursive: true });
  onProgress("researching", "제품 규격과 조립 계약을 분석 중입니다.", Object.fromEntries(payload.components.map((component) => [component, { state: "researching", message: "공통 기준을 분석 중" }])));
  // A build initiated from a draft must never re-run an unreviewed AI planner.
  // It uses the approved dimensions and only the deterministic compiler path.
  const analysis = payload.approvedDraft ? { contract: fallbackContract(payload), source: "approved-draft", model: null } : await createAssemblyContract(payload, imageInputs); const hash = contractHash(analysis.contract);
  await fs.writeFile(path.join(jobDir, "reports", "assembly-contract.json"), `${JSON.stringify({ ...analysis.contract, contractHash: hash }, null, 2)}\n`);
  const needsThreadEvidence = analysis.contract.unresolved.some((item) => /thread|pitch|tolerance|나사|공차/i.test(item));
  onProgress("planning", "공통 조립 계약을 고정하고 컴포넌트 명세를 병렬 생성 중입니다.", Object.fromEntries(payload.components.map((component) => [component, { state: "planning", message: "공통 계약으로 명세 생성 중" }])));
  const specs = await Promise.all(payload.components.map((component) => createComponentSpec({ payload, contract: analysis.contract, component, imageInputs, model: analysis.model })));
  if (specs.some((spec) => spec.contractHash !== hash)) throw new Error("컴포넌트 명세가 공통 조립 계약과 충돌했습니다.");
  const spec = { version: "net30.modeling-spec.v2", summary: analysis.contract.product.name, contract: analysis.contract, components: specs };
  onProgress("building_components", "선택한 컴포넌트의 CAD/Blender 자산을 생성 중입니다.", Object.fromEntries(payload.components.map((component) => [component, { state: "building", message: "독립 CAD/메시 생성 대기" }])));
  const result = await executeBlenderModeling(payload, { assetRoot: root, jobId, spec, onProgress: (state, message) => onProgress(state, message, Object.fromEntries(payload.components.map((component) => [component, { state, message }])))});
  const status = needsThreadEvidence ? "review_required" : "complete";
  const report = { jobId, status, contractHash: hash, manufacturingCandidate: !needsThreadEvidence, requiredReview: needsThreadEvidence ? analysis.contract.unresolved : [], components: specs.map((item) => ({ component: item.component, contractHash: item.contractHash })), generatedAt: new Date().toISOString() };
  await fs.writeFile(path.join(jobDir, "reports", "verification.json"), `${JSON.stringify(report, null, 2)}\n`);
  onProgress(status, needsThreadEvidence ? "시각 GLB는 완료되었습니다. 제조용 나사 도면/공차 확인이 필요합니다." : "조립 검증과 GLB 내보내기가 완료되었습니다.", Object.fromEntries(payload.components.map((component) => [component, { state: "complete", message: "컴포넌트 GLB 생성 완료" }])));
  return { ...result, status, analysis: { source: analysis.source, model: analysis.model, imageCount: imageInputs.length, summary: spec.summary }, modelingSpec: spec, report };
}

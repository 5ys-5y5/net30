import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalizeGraph, fixtureGraphOutput } from "./modeling-graph.mjs";
import { preflightBrepGraph } from "./brep-preflight.mjs";
import { monotoneBezierSegments } from "./image-evidence.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../../../../");
const python = process.env.NET30_CADQUERY_BIN || path.join(repo, ".cadquery-venv/bin/python");
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "net30-cad-proof-"));
try {
  const output = fixtureGraphOutput({ product: { name: "DURAN proof" }, prompt: "100 mL bottle", requestedComponents: ["유리병"], imageIds: [] });
  const canonical = canonicalizeGraph(output, ["유리병"], []); const component = canonical.graph.components[0];
  const stem = path.join(temporary, component.id); const requestPath = path.join(temporary, "request.json");
  await fs.writeFile(requestPath, JSON.stringify({ graphComponent: component, graphNodes: canonical.graph.nodes, paths: { step: `${stem}.step`, brep: `${stem}.brep`, stl: `${stem}.stl`, report: `${stem}.validation.json` }, tessellation: { chordMm: .2, angularDeg: 15 } }));
  const run = spawnSync(python, ["-u", path.join(here, "cad-worker.py"), requestPath], { encoding: "utf8", timeout: 120000 });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  const report = JSON.parse(await fs.readFile(`${stem}.validation.json`, "utf8"));
  assert.equal(report.valid, true); assert.equal(report.closed, true); assert.ok(report.volumeMm3 > 0); assert.ok(report.boundsMm.z > 90);
  assert.equal(typeof report.stepRoundTrip?.withinTolerance, "boolean", "every canonical B-Rep must publish a component STEP round-trip verdict for the manufacturing gate");
  assert.ok(report.silhouette?.length >= 12, "the persisted OCCT tessellation must expose an exterior contour for image-evidence verification");
  for (const suffix of ["step", "brep", "stl"]) assert.ok((await fs.stat(`${stem}.${suffix}`)).size > 100);
  const curvedGraph = structuredClone(canonical.graph);
  const curvedNode = curvedGraph.nodes.find((node) => node.componentId === component.id && node.parameters.profile?.length >= 4);
  const poles = curvedNode.parameters.profile.filter((point, index) => point.xMm > 0 && index % 2 === 0).map(({ xMm, zMm }) => ({ xMm, zMm }));
  const degree = Math.min(3, poles.length - 1); const uniqueKnotCount = poles.length - degree + 1;
  const knots = Array.from({ length: uniqueKnotCount }, (_, index) => index / Math.max(1, uniqueKnotCount - 1));
  curvedNode.parameters.curveSegments = [{ kind: "nurbs", poles, degree, weights: poles.map(() => 1), knots, multiplicities: knots.map((_, index) => index === 0 || index === knots.length - 1 ? degree + 1 : 1), periodic: false }];
  const curveStem = path.join(temporary, `${component.id}-nurbs`); const curveRequest = path.join(temporary, "nurbs.request.json");
  await fs.writeFile(curveRequest, JSON.stringify({ graphComponent: component, graphNodes: curvedGraph.nodes, paths: { step: `${curveStem}.step`, brep: `${curveStem}.brep`, stl: `${curveStem}.stl`, report: `${curveStem}.validation.json` }, tessellation: { chordMm: .2, angularDeg: 15 } }));
  const curveRun = spawnSync(python, ["-u", path.join(here, "cad-worker.py"), curveRequest], { encoding: "utf8", timeout: 120000 });
  assert.equal(curveRun.status, 0, `${curveRun.stdout}\n${curveRun.stderr}`);
  const curveReport = JSON.parse(await fs.readFile(`${curveStem}.validation.json`, "utf8"));
  assert.equal(curveReport.valid, true); assert.equal(curveReport.closed, true); assert.ok(curveReport.volumeMm3 > 0, "a declared NURBS generating curve must compile into a closed OCCT B-Rep");
  const expectedCurveDiameter = Math.max(...curvedNode.parameters.profile.map((point) => point.xMm)) * 2;
  const expectedCurveHeight = Math.max(...curvedNode.parameters.profile.map((point) => point.zMm)) - Math.min(...curvedNode.parameters.profile.map((point) => point.zMm));
  assert.ok(Math.abs(curveReport.boundsMm.x - expectedCurveDiameter) <= .01, "the report must use the persisted B-Rep bounds, not a transient OCCT curve wrapper");
  assert.ok(Math.abs(curveReport.boundsMm.z - expectedCurveHeight) <= .01, "the persisted B-Rep must retain the declared NURBS height");
  const shellOutput = fixtureGraphOutput({ product: { name: "NURBS shell proof" }, prompt: "hollow container", requestedComponents: ["용기"], imageIds: [] });
  const shellBase = shellOutput.components[0].features[0];
  shellOutput.components[0].features.push({ ...structuredClone(shellBase), key: "container-shell", operation: "shell", inputKeys: [shellBase.key], parameters: { ...shellBase.parameters, profile: null, curveSegments: null, thicknessMm: 2.2 } });
  const shellCanonical = canonicalizeGraph(shellOutput, ["용기"], []); const shellComponent = shellCanonical.graph.components[0];
  const shellRevolve = shellCanonical.graph.nodes.find((node) => node.componentId === shellComponent.id && node.operation === "revolve");
  const shellPoles = shellRevolve.parameters.profile.filter((point) => point.xMm > 0).map(({ xMm, zMm }) => ({ xMm, zMm }));
  const shellDegree = Math.min(3, shellPoles.length - 1); const shellKnotCount = shellPoles.length - shellDegree + 1;
  const shellKnots = Array.from({ length: shellKnotCount }, (_, index) => index / Math.max(1, shellKnotCount - 1));
  shellRevolve.parameters.curveSegments = [{ kind: "nurbs", poles: shellPoles, degree: shellDegree, weights: shellPoles.map(() => 1), knots: shellKnots, multiplicities: shellKnots.map((_, index) => index === 0 || index === shellKnots.length - 1 ? shellDegree + 1 : 1), periodic: false }];
  const shellStem = path.join(temporary, `${shellComponent.id}-nurbs-shell`); const shellRequest = path.join(temporary, "nurbs-shell.request.json");
  await fs.writeFile(shellRequest, JSON.stringify({ graphComponent: shellComponent, graphNodes: shellCanonical.graph.nodes, paths: { step: `${shellStem}.step`, brep: `${shellStem}.brep`, stl: `${shellStem}.stl`, report: `${shellStem}.validation.json` }, tessellation: { chordMm: .2, angularDeg: 15 } }));
  const shellRun = spawnSync(python, ["-u", path.join(here, "cad-worker.py"), shellRequest], { encoding: "utf8", timeout: 120000 });
  assert.equal(shellRun.status, 0, `${shellRun.stdout}\n${shellRun.stderr}`);
  const shellReport = JSON.parse(await fs.readFile(`${shellStem}.validation.json`, "utf8"));
  assert.equal(shellReport.valid, true); assert.equal(shellReport.closed, true); assert.equal(shellReport.solidCount, 1, "the NURBS outer wall and derived inner offset must remain one closed B-Rep solid");
  assert.equal(shellReport.stepRoundTrip?.withinTolerance, true, "the one-wire annular shell must retain its inner cavity through STEP export/import");
  const bezierShellGraph = structuredClone(shellCanonical.graph);
  const bezierShellRevolve = bezierShellGraph.nodes.find((node) => node.componentId === shellComponent.id && node.operation === "revolve");
  bezierShellRevolve.parameters.curveSegments = monotoneBezierSegments(bezierShellRevolve.parameters.profile.filter((point) => point.xMm > 0).map(({ xMm, zMm }) => ({ xMm, zMm })));
  const bezierShellStem = path.join(temporary, `${shellComponent.id}-bezier-shell`); const bezierShellRequest = path.join(temporary, "bezier-shell.request.json");
  await fs.writeFile(bezierShellRequest, JSON.stringify({ graphComponent: shellComponent, graphNodes: bezierShellGraph.nodes, paths: { step: `${bezierShellStem}.step`, brep: `${bezierShellStem}.brep`, stl: `${bezierShellStem}.stl`, report: `${bezierShellStem}.validation.json` }, tessellation: { chordMm: .2, angularDeg: 15 } }));
  const bezierShellRun = spawnSync(python, ["-u", path.join(here, "cad-worker.py"), bezierShellRequest], { encoding: "utf8", timeout: 120000 });
  assert.equal(bezierShellRun.status, 0, `${bezierShellRun.stdout}\n${bezierShellRun.stderr}`);
  const bezierShellReport = JSON.parse(await fs.readFile(`${bezierShellStem}.validation.json`, "utf8"));
  assert.equal(bezierShellReport.valid, true); assert.equal(bezierShellReport.closed, true); assert.equal(bezierShellReport.solidCount, 1, "a measured Bézier exterior must keep a valid native OCCT shell");
  assert.equal(bezierShellReport.stepRoundTrip?.withinTolerance, true, "a measured Bézier vessel must keep its curved inner wall through STEP export/import");
  assert.ok(Math.abs(bezierShellReport.boundsMm.z - shellReport.boundsMm.z) <= .01, "the Bézier shell must retain the approved mouth height");
  const capOutput = fixtureGraphOutput({ product: { name: "ribbed closure proof" }, prompt: "ribbed closure", requestedComponents: ["뚜껑"], imageIds: [] });
  const base = capOutput.components[0].features[0];
  base.key = "cap-base"; base.operation = "primitive"; base.inputKeys = [];
  base.parameters = { ...base.parameters, primitive: "cylinder", profile: null, dimensionsMm: null, radiusMm: 25, heightMm: 20, thicknessMm: null, count: null, spacingMm: null, depthMm: null };
  const rib = { ...structuredClone(base), key: "cap-rib", operation: "rib", inputKeys: [base.key], parameters: { ...base.parameters, primitive: null, radiusMm: 25, heightMm: 15, count: null, spacingMm: 1.2, depthMm: 1.4, thicknessMm: null, transform: { translationMm: { x: 0, y: 0, z: 2.5 }, rotationDeg: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } } } };
  const pattern = { ...structuredClone(base), key: "cap-rib-pattern", operation: "pattern", inputKeys: [base.key, rib.key], parameters: { ...base.parameters, primitive: null, profile: null, radiusMm: null, heightMm: null, count: 36, spacingMm: null, depthMm: null, thicknessMm: null } };
  capOutput.components[0].features = [base, rib, pattern];
  const capCanonical = canonicalizeGraph(capOutput, ["뚜껑"], []); const capComponent = capCanonical.graph.components[0]; const capStem = path.join(temporary, capComponent.id); const capRequest = path.join(temporary, "cap.request.json");
  await fs.writeFile(capRequest, JSON.stringify({ graphComponent: capComponent, graphNodes: capCanonical.graph.nodes, paths: { step: `${capStem}.step`, brep: `${capStem}.brep`, stl: `${capStem}.stl`, report: `${capStem}.validation.json` }, tessellation: { chordMm: .2, angularDeg: 15 } }));
  const capRun = spawnSync(python, ["-u", path.join(here, "cad-worker.py"), capRequest], { encoding: "utf8", timeout: 120000 });
  assert.equal(capRun.status, 0, `${capRun.stdout}\n${capRun.stderr}`);
  const capReport = JSON.parse(await fs.readFile(`${capStem}.validation.json`, "utf8"));
  assert.equal(capReport.valid, true); assert.equal(capReport.closed, true); assert.equal(capReport.solidCount, 1, "a patterned ribbed closure must be fused into one B-Rep solid");
  assert.ok(Math.abs(capReport.localDatumShiftMm ?? Infinity) <= 1e-6, "a component already authored on its local assembly datum must not receive an extra placement shift");
  const preflight = await preflightBrepGraph(capCanonical.graph, { preview: { title: "ribbed closure B-Rep review", maxTriangles: 80 } });
  assert.equal(preflight.ok, true, JSON.stringify(preflight.diagnostics));
  assert.equal(preflight.sketchPlan?.version, "net30.brep-sketch.v1", "an approvable sketch must be derived from the same OCCT preflight solid");
  assert.equal(preflight.sketchPlan?.components[0]?.id, capComponent.id);
  assert.ok((preflight.sketchPlan?.components[0]?.meshViews?.front?.length ?? 0) > 0, "the review sketch must contain sampled B-Rep triangles, not a placeholder rectangle");
  const loftOutput = fixtureGraphOutput({ product: { name: "lofted nozzle proof" }, prompt: "tapered square nozzle", requestedComponents: ["노즐"] , imageIds: [] });
  const loftBase = loftOutput.components[0].features[0];
  loftBase.key = "nozzle-loft"; loftBase.operation = "loft"; loftBase.inputKeys = [];
  loftBase.parameters = {
    ...loftBase.parameters,
    primitive: null, profile: null, curveSegments: null,
    profiles: [
      [{ xMm: -20, yMm: -15, zMm: 0 }, { xMm: 20, yMm: -15, zMm: 0 }, { xMm: 20, yMm: 15, zMm: 0 }, { xMm: -20, yMm: 15, zMm: 0 }],
      [{ xMm: -10, yMm: -8, zMm: 30 }, { xMm: 10, yMm: -8, zMm: 30 }, { xMm: 10, yMm: 8, zMm: 30 }, { xMm: -10, yMm: 8, zMm: 30 }],
    ],
    dimensionsMm: null, radiusMm: null, innerRadiusMm: null, heightMm: null, thicknessMm: null, count: null, spacingMm: null, depthMm: null,
  };
  const loftCanonical = canonicalizeGraph(loftOutput, ["노즐"], []); const loftComponent = loftCanonical.graph.components[0]; const loftStem = path.join(temporary, loftComponent.id); const loftRequest = path.join(temporary, "loft.request.json");
  await fs.writeFile(loftRequest, JSON.stringify({ graphComponent: loftComponent, graphNodes: loftCanonical.graph.nodes, paths: { step: `${loftStem}.step`, brep: `${loftStem}.brep`, stl: `${loftStem}.stl`, report: `${loftStem}.validation.json` }, tessellation: { chordMm: .05, angularDeg: 7 } }));
  const loftRun = spawnSync(python, ["-u", path.join(here, "cad-worker.py"), loftRequest], { encoding: "utf8", timeout: 120000 });
  assert.equal(loftRun.status, 0, `${loftRun.stdout}\n${loftRun.stderr}`);
  const loftReport = JSON.parse(await fs.readFile(`${loftStem}.validation.json`, "utf8"));
  assert.equal(loftReport.valid, true); assert.equal(loftReport.closed, true); assert.equal(loftReport.solidCount, 1, "a generic multi-profile loft must become one canonical B-Rep solid");
  assert.ok(Math.abs(loftReport.boundsMm.z - 30) <= .01, "the loft's component-local axial datum must survive persisted B-Rep export");
  const housingOutput = fixtureGraphOutput({ product: { name: "extruded housing proof" }, prompt: "rectangular housing", requestedComponents: ["하우징"], imageIds: [] });
  const housingBase = housingOutput.components[0].features[0];
  housingBase.key = "housing-extrude"; housingBase.operation = "extrude"; housingBase.inputKeys = [];
  housingBase.parameters = {
    ...housingBase.parameters,
    primitive: null, curveSegments: null, profiles: null,
    profile: [{ xMm: -20, yMm: -15, zMm: 0 }, { xMm: 20, yMm: -15, zMm: 0 }, { xMm: 20, yMm: 15, zMm: 0 }, { xMm: -20, yMm: 15, zMm: 0 }],
    dimensionsMm: null, radiusMm: null, innerRadiusMm: null, heightMm: 18, thicknessMm: null, count: null, spacingMm: null, depthMm: null,
  };
  const housingCanonical = canonicalizeGraph(housingOutput, ["하우징"], []); const housingComponent = housingCanonical.graph.components[0]; const housingStem = path.join(temporary, housingComponent.id); const housingRequest = path.join(temporary, "housing.request.json");
  await fs.writeFile(housingRequest, JSON.stringify({ graphComponent: housingComponent, graphNodes: housingCanonical.graph.nodes, paths: { step: `${housingStem}.step`, brep: `${housingStem}.brep`, stl: `${housingStem}.stl`, report: `${housingStem}.validation.json` }, tessellation: { chordMm: .05, angularDeg: 7 } }));
  const housingRun = spawnSync(python, ["-u", path.join(here, "cad-worker.py"), housingRequest], { encoding: "utf8", timeout: 120000 });
  assert.equal(housingRun.status, 0, `${housingRun.stdout}\n${housingRun.stderr}`);
  const housingReport = JSON.parse(await fs.readFile(`${housingStem}.validation.json`, "utf8"));
  assert.equal(housingReport.valid, true); assert.equal(housingReport.closed, true); assert.equal(housingReport.solidCount, 1, "an approved XY sketch must compile as an extrusion, not a substitute cylinder");
  assert.ok(Math.abs(housingReport.boundsMm.x - 40) <= .01 && Math.abs(housingReport.boundsMm.y - 30) <= .01 && Math.abs(housingReport.boundsMm.z - 18) <= .01, "the extrusion must retain the approved sketch dimensions");
  const roofedOutput = fixtureGraphOutput({ product: { name: "roofed closure proof" }, prompt: "tapered ribbed closure", requestedComponents: ["마개"], imageIds: [] });
  const roofBase = roofedOutput.components[0].features[0];
  roofBase.key = "roof-base"; roofBase.operation = "revolve"; roofBase.inputKeys = [];
  roofBase.parameters = { ...roofBase.parameters, primitive: null, profile: [{ xMm: 0, yMm: 0, zMm: 0 }, { xMm: 25, yMm: 0, zMm: 0 }, { xMm: 25, yMm: 0, zMm: 2 }, { xMm: 22, yMm: 0, zMm: 2 }, { xMm: 22, yMm: 0, zMm: 20 }, { xMm: 0, yMm: 0, zMm: 22 }, { xMm: 0, yMm: 0, zMm: 0 }], dimensionsMm: null, radiusMm: null, heightMm: null, thicknessMm: null, count: null, spacingMm: null, depthMm: null };
  const roofShell = { ...structuredClone(roofBase), key: "roof-shell", operation: "shell", inputKeys: [roofBase.key], parameters: { ...roofBase.parameters, profile: null, thicknessMm: 2 } };
  const roofRib = { ...structuredClone(roofBase), key: "roof-rib", operation: "rib", inputKeys: [roofShell.key], parameters: { ...roofBase.parameters, profile: null, heightMm: 15, thicknessMm: null, spacingMm: 1.2, depthMm: 1.4, count: null, transform: { translationMm: { x: 0, y: 0, z: 3 }, rotationDeg: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } } } };
  const roofPattern = { ...structuredClone(roofBase), key: "roof-rib-pattern", operation: "pattern", inputKeys: [roofShell.key, roofRib.key], parameters: { ...roofBase.parameters, profile: null, heightMm: null, count: 36, spacingMm: null, depthMm: null, thicknessMm: null } };
  roofedOutput.components[0].features = [roofBase, roofShell, roofRib, roofPattern];
  const roofCanonical = canonicalizeGraph(roofedOutput, ["마개"], []); const roofComponent = roofCanonical.graph.components[0]; const roofStem = path.join(temporary, roofComponent.id); const roofRequest = path.join(temporary, "roof.request.json");
  await fs.writeFile(roofRequest, JSON.stringify({ graphComponent: roofComponent, graphNodes: roofCanonical.graph.nodes, paths: { step: `${roofStem}.step`, brep: `${roofStem}.brep`, stl: `${roofStem}.stl`, report: `${roofStem}.validation.json` }, tessellation: { chordMm: .2, angularDeg: 15 } }));
  const roofRun = spawnSync(python, ["-u", path.join(here, "cad-worker.py"), roofRequest], { encoding: "utf8", timeout: 120000 });
  assert.equal(roofRun.status, 0, `${roofRun.stdout}\n${roofRun.stderr}`);
  const roofReport = JSON.parse(await fs.readFile(`${roofStem}.validation.json`, "utf8"));
  assert.equal(roofReport.solidCount, 1, "a roofed shell with surface-following ribs must remain one B-Rep solid");
  const assemblyRequest = path.join(temporary, "assembly.request.json"); const assemblyPaths = { xbf: path.join(temporary, "assembly.xbf"), step: path.join(temporary, "assembly.step"), report: path.join(temporary, "assembly.validation.json") };
  await fs.writeFile(assemblyRequest, JSON.stringify({ name: "DURAN proof", components: [{ id: component.id, brep: `${stem}.brep` }], paths: assemblyPaths, toleranceMm: .01 }));
  const assemblyRun = spawnSync(python, [path.join(here, "cad-assembly-worker.py"), assemblyRequest], { encoding: "utf8", timeout: 120000 });
  assert.equal(assemblyRun.status, 0, `${assemblyRun.stdout}\n${assemblyRun.stderr}`); const assemblyReport = JSON.parse(await fs.readFile(assemblyPaths.report, "utf8"));
  assert.equal(assemblyReport.valid, true); assert.equal(assemblyReport.roundTripWithinTolerance, true); assert.ok((await fs.stat(assemblyPaths.xbf)).size > 100); assert.ok((await fs.stat(assemblyPaths.step)).size > 100);
  // A numerically out-of-tolerance STEP must remain inspectable as a valid
  // B-Rep assembly.  The JS release gate turns this report into a manufacturing
  // blocker; the worker itself must not prevent the visual review GLB.
  const blockedRequest = path.join(temporary, "blocked-assembly.request.json");
  await fs.writeFile(blockedRequest, JSON.stringify({ ...JSON.parse(await fs.readFile(assemblyRequest, "utf8")), paths: { xbf: path.join(temporary, "blocked.xbf"), step: path.join(temporary, "blocked.step"), report: path.join(temporary, "blocked.report.json") }, toleranceMm: -1 }));
  const blockedRun = spawnSync(python, [path.join(here, "cad-assembly-worker.py"), blockedRequest], { encoding: "utf8", timeout: 120000 });
  assert.equal(blockedRun.status, 0, `${blockedRun.stdout}\n${blockedRun.stderr}`); const blockedReport = JSON.parse(await fs.readFile(path.join(temporary, "blocked.report.json"), "utf8"));
  assert.equal(blockedReport.valid, true); assert.equal(blockedReport.roundTripWithinTolerance, false);
  console.log("Canonical child B-Rep plus parent XBF/STEP round-trip proof passed.");
} finally { await fs.rm(temporary, { recursive: true, force: true }); }

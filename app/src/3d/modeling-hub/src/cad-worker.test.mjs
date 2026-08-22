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
  assert.equal(report.valid, true); assert.equal(report.closed, true); assert.equal(report.freeEdges, 0, "a manufacturing component must report no B-Rep boundary edges"); assert.ok(report.volumeMm3 > 0); assert.ok(report.boundsMm.z > 90);
  assert.equal(typeof report.stepRoundTrip?.withinTolerance, "boolean", "every canonical B-Rep must publish a component STEP round-trip verdict for the manufacturing gate");
  assert.ok(report.silhouette?.length >= 12, "the persisted OCCT tessellation must expose an exterior contour for image-evidence verification");
  assert.ok(report.silhouette[0].radiusNorm > .1 && report.silhouette.at(-1).radiusNorm > .1, "a closed revolved solid must measure its adjacent exterior at the first and last contour sections instead of collapsing both boundary poles to zero");
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
  // Old, already-approved product files encoded a radial cap rib array as a
  // translated box with a positive count and inline union. It is not an
  // unknown-shape fallback: the graph still supplies the host, cross-section,
  // radial datum, axial height and exact instance count. Keep that historic
  // feature visible while new analyses use the explicit rib -> pattern DAG.
  const legacyRibCanonical = structuredClone(capCanonical);
  const legacyRibComponent = legacyRibCanonical.graph.components[0];
  const legacyBase = legacyRibCanonical.graph.nodes.find((node) => node.componentId === legacyRibComponent.id && node.operation === "primitive");
  const legacyRib = { ...structuredClone(legacyBase), id: "legacy-cap-rib-array", operation: "primitive", inputNodeIds: [legacyBase.id], parameters: { ...legacyBase.parameters, primitive: "box", dimensionsMm: { x: 1.3, y: 4, z: 16 }, radiusMm: null, heightMm: 16, count: 36, operation: "union", transform: { translationMm: { x: 25.5, y: 0, z: 2 }, rotationDeg: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } } } };
  legacyRibCanonical.graph.nodes = [legacyBase, legacyRib];
  legacyRibComponent.rootNodeIds = [legacyRib.id];
  const legacyRibStem = path.join(temporary, legacyRibComponent.id); const legacyRibRequest = path.join(temporary, "legacy-rib.request.json");
  await fs.writeFile(legacyRibRequest, JSON.stringify({ graphComponent: legacyRibComponent, graphNodes: legacyRibCanonical.graph.nodes, paths: { step: `${legacyRibStem}.step`, brep: `${legacyRibStem}.brep`, stl: `${legacyRibStem}.stl`, report: `${legacyRibStem}.validation.json` }, tessellation: { chordMm: .2, angularDeg: 15 } }));
  const legacyRibRun = spawnSync(python, ["-u", path.join(here, "cad-worker.py"), legacyRibRequest], { encoding: "utf8", timeout: 120000 });
  assert.equal(legacyRibRun.status, 0, `${legacyRibRun.stdout}\n${legacyRibRun.stderr}`);
  const legacyRibReport = JSON.parse(await fs.readFile(`${legacyRibStem}.validation.json`, "utf8"));
  assert.equal(legacyRibReport.valid, true); assert.equal(legacyRibReport.closed, true); assert.equal(legacyRibReport.solidCount, 1, "a legacy counted radial primitive must remain one fused cap solid");
  assert.ok(legacyRibReport.surfaceAreaMm2 > 2 * Math.PI * 25 * 20, "all declared legacy rib instances must contribute actual B-Rep surface, not collapse to one box");
  const preflight = await preflightBrepGraph(capCanonical.graph, { preview: { title: "ribbed closure B-Rep review", maxTriangles: 80 } });
  assert.equal(preflight.ok, true, JSON.stringify(preflight.diagnostics));
  assert.equal(preflight.assembly?.report?.interferenceCount, 0, "a final preflight must run an XDE/STEP assembly check even when it contains one child");
  assert.equal(preflight.assembly?.report?.roundTripWithinTolerance, true, "the final assembly preflight must publish the STEP round-trip verdict");
  assert.equal(preflight.sketchPlan?.version, "net30.brep-sketch.v1", "an approvable sketch must be derived from the same OCCT preflight solid");
  assert.equal(preflight.sketchPlan?.components[0]?.id, capComponent.id);
  assert.ok((preflight.sketchPlan?.components[0]?.views?.front?.length ?? 0) >= 4, "the review sketch must contain the normalized exterior from the same B-Rep, not a placeholder rectangle");
  assert.equal(preflight.sketchPlan?.components[0]?.meshViews, undefined, "the approval sketch must never expose temporary STL triangles as design geometry");
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
  const sweepOutput = fixtureGraphOutput({ product: { name: "swept handle proof" }, prompt: "curved industrial tube", requestedComponents: ["손잡이"] , imageIds: [] });
  const sweepBase = sweepOutput.components[0].features[0];
  sweepBase.key = "handle-sweep"; sweepBase.operation = "sweep"; sweepBase.inputKeys = [];
  sweepBase.parameters = {
    ...sweepBase.parameters,
    primitive: null, curveSegments: null, profiles: null,
    profile: null,
    path: [{ xMm: 0, yMm: 0, zMm: 0 }, { xMm: 0, yMm: 0, zMm: 30 }, { xMm: 24, yMm: 12, zMm: 48 }],
    dimensionsMm: null, radiusMm: 3.5, innerRadiusMm: null, heightMm: null, thicknessMm: null, count: null, spacingMm: null, depthMm: null,
  };
  const sweepCanonical = canonicalizeGraph(sweepOutput, ["손잡이"], []); const sweepComponent = sweepCanonical.graph.components[0]; const sweepStem = path.join(temporary, sweepComponent.id); const sweepRequest = path.join(temporary, "sweep.request.json");
  await fs.writeFile(sweepRequest, JSON.stringify({ graphComponent: sweepComponent, graphNodes: sweepCanonical.graph.nodes, paths: { step: `${sweepStem}.step`, brep: `${sweepStem}.brep`, stl: `${sweepStem}.stl`, report: `${sweepStem}.validation.json` }, tessellation: { chordMm: .05, angularDeg: 7 } }));
  const sweepRun = spawnSync(python, ["-u", path.join(here, "cad-worker.py"), sweepRequest], { encoding: "utf8", timeout: 120000 });
  assert.equal(sweepRun.status, 0, `${sweepRun.stdout}\n${sweepRun.stderr}`);
  const sweepReport = JSON.parse(await fs.readFile(`${sweepStem}.validation.json`, "utf8"));
  assert.equal(sweepReport.valid, true); assert.equal(sweepReport.closed, true); assert.equal(sweepReport.solidCount, 1, "a 3-D swept tube must become one canonical B-Rep solid");
  assert.equal(sweepReport.stepRoundTrip?.withinTolerance, true, "a swept B-Rep must retain its path and section through STEP export/import");
  // Frenet orientation rotates the circular section through the final elbow,
  // so the envelope is not the raw endpoint plus two radii on each axis. The
  // persisted B-Rep must nevertheless span every path axis; a planar
  // placeholder extrusion would have no comparable Y extent.
  assert.ok(sweepReport.boundsMm.x > 20 && sweepReport.boundsMm.y > 15 && sweepReport.boundsMm.z > 47, "the swept B-Rep must retain all three path axes rather than flattening to a placeholder extrusion");
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
  roofBase.parameters = { ...roofBase.parameters, primitive: null, profile: [{ xMm: 0, yMm: 0, zMm: 0 }, { xMm: 25, yMm: 0, zMm: 0 }, { xMm: 25, yMm: 0, zMm: 2 }, { xMm: 22, yMm: 0, zMm: 2 }, { xMm: 18, yMm: 0, zMm: 20 }, { xMm: 0, yMm: 0, zMm: 22 }, { xMm: 0, yMm: 0, zMm: 0 }], dimensionsMm: null, radiusMm: null, heightMm: null, thicknessMm: null, count: null, spacingMm: null, depthMm: null };
  const roofShell = { ...structuredClone(roofBase), key: "roof-shell", operation: "shell", inputKeys: [roofBase.key], parameters: { ...roofBase.parameters, profile: null, thicknessMm: 2, cavityOpenAt: "bottom" } };
  const roofRib = { ...structuredClone(roofBase), key: "roof-rib", operation: "rib", inputKeys: [roofShell.key], parameters: { ...roofBase.parameters, profile: null, heightMm: 15, thicknessMm: null, spacingMm: 1.2, depthMm: 1.4, count: null, transform: { translationMm: { x: 0, y: 0, z: 3 }, rotationDeg: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } } } };
  const roofPattern = { ...structuredClone(roofBase), key: "roof-rib-pattern", operation: "pattern", inputKeys: [roofShell.key, roofRib.key], parameters: { ...roofBase.parameters, profile: null, heightMm: null, count: 36, spacingMm: null, depthMm: null, thicknessMm: null } };
  roofedOutput.components[0].features = [roofBase, roofShell, roofRib, roofPattern];
  const roofCanonical = canonicalizeGraph(roofedOutput, ["마개"], []); const roofComponent = roofCanonical.graph.components[0]; const roofStem = path.join(temporary, roofComponent.id); const roofRequest = path.join(temporary, "roof.request.json");
  await fs.writeFile(roofRequest, JSON.stringify({ graphComponent: roofComponent, graphNodes: roofCanonical.graph.nodes, paths: { step: `${roofStem}.step`, brep: `${roofStem}.brep`, stl: `${roofStem}.stl`, report: `${roofStem}.validation.json` }, tessellation: { chordMm: .2, angularDeg: 15 } }));
  const roofRun = spawnSync(python, ["-u", path.join(here, "cad-worker.py"), roofRequest], { encoding: "utf8", timeout: 120000 });
  assert.equal(roofRun.status, 0, `${roofRun.stdout}\n${roofRun.stderr}`);
  const roofReport = JSON.parse(await fs.readFile(`${roofStem}.validation.json`, "utf8"));
  assert.equal(roofReport.solidCount, 1, "a roofed shell with surface-following ribs must remain one B-Rep solid");
  assert.ok(roofReport.silhouette[48].radiusNorm < roofReport.silhouette[16].radiusNorm * .96, `a rib on a tapered host must follow the host radius toward the roof instead of remaining a vertical constant-radius box (lower=${roofReport.silhouette[16].radiusNorm}, upper=${roofReport.silhouette[48].radiusNorm})`);
  // A component-local worker must not compile an unrelated broken graph node.
  // Parent XDE assembly is responsible for placing child B-Reps; a preflight
  // of child A is not a covert full-assembly compile.
  const isolatedRequest = path.join(temporary, "isolated.request.json");
  const isolatedPayload = JSON.parse(await fs.readFile(roofRequest, "utf8"));
  isolatedPayload.graphNodes.push({ id: "unrelated-invalid", componentId: "other-component", operation: "boolean", inputNodeIds: [], parameters: { operation: "cut" } });
  await fs.writeFile(isolatedRequest, JSON.stringify(isolatedPayload));
  const isolatedRun = spawnSync(python, ["-u", path.join(here, "cad-worker.py"), isolatedRequest], { encoding: "utf8", timeout: 120000 });
  assert.equal(isolatedRun.status, 0, "a component-local B-Rep compile must ignore invalid features owned by another component");
  const assemblyRequest = path.join(temporary, "assembly.request.json"); const assemblyPaths = { xbf: path.join(temporary, "assembly.xbf"), step: path.join(temporary, "assembly.step"), report: path.join(temporary, "assembly.validation.json") };
  await fs.writeFile(assemblyRequest, JSON.stringify({ name: "DURAN proof", components: [{ id: component.id, brep: `${stem}.brep` }], paths: assemblyPaths, toleranceMm: .01 }));
  const assemblyRun = spawnSync(python, [path.join(here, "cad-assembly-worker.py"), assemblyRequest], { encoding: "utf8", timeout: 120000 });
  assert.equal(assemblyRun.status, 0, `${assemblyRun.stdout}\n${assemblyRun.stderr}`); const assemblyReport = JSON.parse(await fs.readFile(assemblyPaths.report, "utf8"));
  assert.equal(assemblyReport.valid, true); assert.equal(assemblyReport.roundTripWithinTolerance, true); assert.ok((await fs.stat(assemblyPaths.xbf)).size > 100); assert.ok((await fs.stat(assemblyPaths.step)).size > 100);
  assert.equal(assemblyReport.interferenceCount, 0, "a one-component assembly has no forbidden pairwise material intersections");
  const overlapRequest = path.join(temporary, "overlap-assembly.request.json"); const overlapPaths = { xbf: path.join(temporary, "overlap.xbf"), step: path.join(temporary, "overlap.step"), report: path.join(temporary, "overlap.report.json") };
  await fs.writeFile(overlapRequest, JSON.stringify({ name: "interference proof", components: [{ id: "left", brep: `${stem}.brep` }, { id: "right", brep: `${stem}.brep`, transform: { translationMm: { x: 1, y: 0, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 } } }], interfaces: [{ id: "declared-mate", componentIds: ["left", "right"], kind: "mate", clearanceMm: .2 }], paths: overlapPaths, toleranceMm: .01 }));
  const overlapRun = spawnSync(python, [path.join(here, "cad-assembly-worker.py"), overlapRequest], { encoding: "utf8", timeout: 120000 });
  assert.equal(overlapRun.status, 0, `${overlapRun.stdout}\n${overlapRun.stderr}`); const overlapReport = JSON.parse(await fs.readFile(overlapPaths.report, "utf8"));
  assert.ok(overlapReport.interferenceCount > 0, "a declared mate still cannot hide overlapping B-Rep material"); assert.ok(overlapReport.interferencePairs[0].relations.some((item) => item.id === "declared-mate"), "the dossier must retain interface context for an interference");
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

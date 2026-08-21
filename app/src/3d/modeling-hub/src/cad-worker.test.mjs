import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalizeGraph, fixtureGraphOutput } from "./modeling-graph.mjs";

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
  for (const suffix of ["step", "brep", "stl"]) assert.ok((await fs.stat(`${stem}.${suffix}`)).size > 100);
  const assemblyRequest = path.join(temporary, "assembly.request.json"); const assemblyPaths = { xbf: path.join(temporary, "assembly.xbf"), step: path.join(temporary, "assembly.step"), report: path.join(temporary, "assembly.validation.json") };
  await fs.writeFile(assemblyRequest, JSON.stringify({ name: "DURAN proof", components: [{ id: component.id, brep: `${stem}.brep` }], paths: assemblyPaths, toleranceMm: .01 }));
  const assemblyRun = spawnSync(python, [path.join(here, "cad-assembly-worker.py"), assemblyRequest], { encoding: "utf8", timeout: 120000 });
  assert.equal(assemblyRun.status, 0, `${assemblyRun.stdout}\n${assemblyRun.stderr}`); const assemblyReport = JSON.parse(await fs.readFile(assemblyPaths.report, "utf8"));
  assert.equal(assemblyReport.valid, true); assert.equal(assemblyReport.roundTripWithinTolerance, true); assert.ok((await fs.stat(assemblyPaths.xbf)).size > 100); assert.ok((await fs.stat(assemblyPaths.step)).size > 100);
  console.log("Canonical child B-Rep plus parent XBF/STEP round-trip proof passed.");
} finally { await fs.rm(temporary, { recursive: true, force: true }); }

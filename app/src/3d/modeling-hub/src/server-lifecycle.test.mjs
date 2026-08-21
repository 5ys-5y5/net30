import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const assetRoot=await fs.mkdtemp(path.join(os.tmpdir(),"net30-modeling-hub-lifecycle-"));
const serverPath=fileURLToPath(new URL("./server.mjs",import.meta.url));
const testPort=19000+Math.floor(Math.random()*1000);
const child=spawn(process.execPath,[serverPath],{
  cwd:path.dirname(serverPath),
  env:{...process.env,HOST:"127.0.0.1",NET30_MODELING_HUB_PORT:String(testPort),NET30_3D_ASSET_ROOT:assetRoot,NET30_MODELING_HUB_TOKEN:"",NET30_LIFECYCLE_TEST_KEEPALIVE:"true"},
  stdio:["ignore","pipe","pipe"]
});
let output="";
let terminationSent=false;
child.stdout.on("data",(chunk)=>{
  output+=chunk;
  if(!terminationSent&&output.includes(`NET30 modeling hub listening on ${testPort}`)){
    terminationSent=true;
    setTimeout(()=>child.kill("SIGTERM"),100);
  }
});
child.stderr.on("data",(chunk)=>{ output+=chunk; });
const result=await Promise.race([
  new Promise((resolve)=>child.once("close",(code,signal)=>resolve({code,signal}))),
  new Promise((_,reject)=>setTimeout(()=>reject(new Error(`server lifecycle test timed out\n${output}`)),30000))
]);
// Child stdio can flush on the close turn in recent Node releases.  Yield once
// before asserting the synchronously written shutdown marker.
await new Promise((resolve)=>setImmediate(resolve));
await fs.rm(assetRoot,{recursive:true,force:true});
assert.deepEqual(result,{code:0,signal:null});
assert.match(output,/received SIGTERM/);
assert.match(output,/shutdown complete/);
assert.doesNotMatch(output,/npm error|command failed/);
console.log("server lifecycle SIGTERM test passed");

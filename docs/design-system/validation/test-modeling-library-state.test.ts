const {
  mergeComponentVersions,
  removeComponentVersion,
  removeSelectedVersion,
} = await import(new URL("../modeling-library-state.ts", import.meta.url).href);

const bottle = { id: "bottle-v1", ordinal: 1, summary: "bottle", createdAt: "2026-08-20T00:00:00.000Z", assetPath: "/bottle.glb" };
const cap = { id: "cap-v1", ordinal: 1, summary: "cap", createdAt: "2026-08-20T00:00:00.000Z", assetPath: "/cap.glb" };
const current = { bottle: [bottle], cap: [cap] };

function expectEqual(actual: unknown, expected: unknown, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(message);
}

expectEqual(mergeComponentVersions(current, { bottle: [] }), { bottle: [], cap: [cap] }, "targeted refresh must preserve unrelated components");
expectEqual(removeComponentVersion(current, "bottle", bottle.id), { bottle: [], cap: [cap] }, "deletion must preserve unrelated components");
expectEqual(removeSelectedVersion({ bottle: bottle.id, cap: cap.id }, "bottle", bottle.id), { cap: cap.id }, "selected deletion must remove only its component");
expectEqual(removeSelectedVersion({ bottle: bottle.id, cap: cap.id }, "bottle", "other"), { bottle: bottle.id, cap: cap.id }, "unrelated deletion must preserve selections");

console.log("Modeling library state proof passed: targeted refresh and deletion preserve unrelated components.");

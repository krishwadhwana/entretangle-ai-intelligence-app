type Kind = "folder" | "dashboard" | "project" | "export";

type TreeNode = {
  id: string;
  parentId: string | null;
  kind: Kind;
  title: string;
  refProjectId?: string | null;
};

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

function wouldCycle(
  nodes: TreeNode[],
  nodeId: string,
  nextParentId: string | null,
) {
  let cursor = nextParentId;
  while (cursor) {
    if (cursor === nodeId) return true;
    cursor = nodes.find((node) => node.id === cursor)?.parentId ?? null;
  }
  return false;
}

function moveNode(nodes: TreeNode[], nodeId: string, parentId: string | null) {
  assert(!wouldCycle(nodes, nodeId, parentId), "cycle rejected");
  return nodes.map((node) =>
    node.id === nodeId ? { ...node, parentId } : node,
  );
}

function deleteFolder(nodes: TreeNode[], folderId: string) {
  const folder = nodes.find((node) => node.id === folderId);
  if (!folder || folder.kind !== "folder") throw new Error("folder exists");
  const parentId = folder.parentId;
  return nodes
    .filter((node) => node.id !== folderId)
    .map((node) =>
      node.parentId === folderId ? { ...node, parentId } : node,
    );
}

let nodes: TreeNode[] = [
  { id: "f-a", parentId: null, kind: "folder", title: "Letssmush" },
  { id: "f-b", parentId: "f-a", kind: "folder", title: "Launch" },
  { id: "p-6", parentId: null, kind: "project", title: "Letssmush 6", refProjectId: "6" },
  { id: "p-7", parentId: null, kind: "project", title: "Letssmush 7", refProjectId: "7" },
];

assert(nodes.find((node) => node.id === "f-b")?.parentId === "f-a", "created subfolder");

let cycleBlocked = false;
try {
  nodes = moveNode(nodes, "f-a", "f-b");
} catch {
  cycleBlocked = true;
}
assert(cycleBlocked, "folder cycle is blocked");

nodes = moveNode(nodes, "f-b", null);
assert(nodes.find((node) => node.id === "f-b")?.parentId === null, "moved folder");

nodes = nodes.map((node) =>
  node.id === "p-6" || node.id === "p-7"
    ? { ...node, parentId: "f-a" }
    : node,
);
assert(
  nodes.filter((node) => node.parentId === "f-a" && node.kind === "project")
    .length === 2,
  "moved multiple projects into one folder",
);

nodes = deleteFolder(nodes, "f-a");
assert(!nodes.some((node) => node.id === "f-a"), "deleted folder");
assert(
  nodes.find((node) => node.id === "p-6")?.parentId === null &&
    nodes.find((node) => node.id === "p-7")?.parentId === null,
  "folder delete lifts children instead of deleting projects",
);

console.log("workspace tree checks passed");

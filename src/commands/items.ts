// Worked example command showing the AXI patterns in one place:
// minimal default schema + --fields (principle 2), total-count aggregate
// (principle 4), definitive empty state (principle 5), and contextual
// suggestions (principle 9). Replace with your tool's real commands.

import type { CommandModule } from "../cli/router.js";
import { UsageError } from "../output/errors.js";
import { emitList, print } from "../output/toon.js";
import { helpBlock } from "../output/suggest.js";

interface Item {
  id: number;
  title: string;
  status: "open" | "closed";
  body: string;
}

// TODO: replace the demo data with your real backend.
const ITEMS: Item[] = [
  { id: 1, title: "Replace this demo with live content", status: "open", body: "Wire homeBody() in src/skill/content.ts to your data." },
  { id: 2, title: "Wire your first real command", status: "open", body: "Copy this file as a starting point." },
  { id: 3, title: "Read the AXI checklist", status: "closed", body: "Run: npx -y axi-axi checklist --phase implement" },
];

const FIELDS = ["id", "title", "status", "body"];

export const itemsList: CommandModule = {
  spec: {
    name: "items list",
    summary: "List demo items",
    flags: [
      { name: "status", type: "string", values: ["open", "closed"], description: "filter by status" },
      {
        name: "fields",
        type: "string",
        default: "id,title,status",
        description: `comma-separated columns from: ${FIELDS.join(", ")}`,
      },
    ],
    examples: [
      "junit-axi items list --status open",
      "junit-axi items list --fields id,title,body",
    ],
  },
  run(parsed) {
    const fields = String(parsed.flags["fields"]).split(",").map((f) => f.trim());
    for (const f of fields) {
      if (!FIELDS.includes(f)) {
        throw new UsageError(`unknown field '${f}' for --fields`, `valid fields: ${FIELDS.join(", ")}`);
      }
    }
    const status = parsed.flags["status"] as string | undefined;
    const rows = ITEMS.filter((i) => status === undefined || i.status === status);

    if (rows.length === 0) {
      // Definitive empty state: name the context and the active filter.
      print(`items: 0 ${status ?? ""} items found`.replace(/\s+/g, " "));
      print(helpBlock(["junit-axi items list"]));
      return 0;
    }

    print(emitList("items", rows.map((r) => ({ ...r })), fields, { total: ITEMS.length }));
    print(helpBlock(["junit-axi items list --fields id,title,body"]));
    return 0;
  },
};

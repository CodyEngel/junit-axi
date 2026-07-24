import { dispatch, type Registry } from "./cli/router.js";
import { homeCommand, rootHelp } from "./commands/home.js";
import { itemsList } from "./commands/items.js";

const registry: Registry = {
  tool: "junit-axi",
  root: homeCommand,
  rootHelp,
  commands: {
    // TODO: replace the demo command with your tool's real noun-verb commands.
    "items list": itemsList,
  },
  aliases: {
    items: "items list",
  },
};

const code = await dispatch(registry, process.argv.slice(2));
process.exit(code);

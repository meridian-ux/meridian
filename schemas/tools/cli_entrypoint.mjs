import { existsSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Node resolves import.meta.url through symlinks but may retain the alias in
// argv[1]. Compare physical files so an aliased CLI cannot silently skip main.
// Missing entry paths also occur when these modules are imported from --eval.
export function isMain(moduleUrl, entry = process.argv[1]) {
  return Boolean(entry && existsSync(entry)
    && realpathSync(entry) === realpathSync(fileURLToPath(moduleUrl)));
}

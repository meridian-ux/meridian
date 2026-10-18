// @vitest-environment jsdom
import { htmlKit } from "../src/html_kit.js";
import { shadcnKit } from "../src/shadcn_kit.js";
import { affordanceContract } from "./affordance_contract.js";
import { MeridianProvider } from "../src/provider.js";
import { PanelRenderer } from "../src/panel_renderer.js";
import { reactWebRenderer } from "../src/react_web_renderer.js";
const runtime = { MeridianProvider, PanelRenderer, reactWebRenderer };
affordanceContract(htmlKit, runtime);
affordanceContract(shadcnKit, runtime);

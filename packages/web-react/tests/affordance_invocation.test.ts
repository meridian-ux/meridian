// @vitest-environment jsdom
import { htmlKit } from "../src/html_kit.js";
import { shadcnKit } from "../src/shadcn_kit.js";
import { affordanceContract } from "./affordance_contract.js";
import { MeridianProvider } from "../src/provider.js";
import { PanelRenderer } from "../src/panel_renderer.js";
import { reactWebRenderer } from "../src/react_web_renderer.js";
import { ViewRenderer } from "../src/view_renderer.js";
import { actionSourcesContract } from "./action_sources_contract.js";
const runtime = { MeridianProvider, PanelRenderer, reactWebRenderer, ViewRenderer };
affordanceContract(htmlKit, runtime);
affordanceContract(shadcnKit, runtime);
actionSourcesContract(htmlKit, runtime);
actionSourcesContract(shadcnKit, runtime);

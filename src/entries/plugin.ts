import { createAntigravityPlugin } from "../opencode/plugin.js";

export default createAntigravityPlugin(new URL("./sdk.js", import.meta.url).href);

import { createAntigravityPlugin } from "../opencode/plugin.js";

/**
 * OpenCode's plugin loader expects the default export to be the plugin factory.
 * The entry point passes the URL of the compiled sdk.js module.
 */
export default createAntigravityPlugin(new URL("./sdk.js", import.meta.url).href);

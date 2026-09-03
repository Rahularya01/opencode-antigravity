import { createAntigravityPlugin } from "../opencode/plugin.js";

const server = createAntigravityPlugin(new URL("./sdk.js", import.meta.url).href);

export default {
  id: "@rahularya01/opencode-antigravity",
  server,
};

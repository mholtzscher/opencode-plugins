import { Plugin } from "@opencode/plugin";

import { readDaemons } from "./discovery.js";
import { MiseDaemons } from "./rpc.js";

export default Plugin.define({
  id: "mise-daemons",
  async setup(context) {
    const registration = await context.rpc.register(MiseDaemons, {
      list: (_input, request) =>
        readDaemons(context.location.directory, request.signal),
    });
    return () => registration.dispose();
  },
});

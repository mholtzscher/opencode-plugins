import { Plugin } from "@opencode/plugin";

import { createStopAll } from "./control.js";
import { readDaemons } from "./discovery.js";
import { MiseDaemons } from "./rpc.js";

export default Plugin.define({
  id: "mise-daemons",
  async setup(context) {
    const stopAll = createStopAll(context.location.directory);
    const registration = await context.rpc.register(MiseDaemons, {
      list: (_input, request) =>
        readDaemons(context.location.directory, request.signal),
      stopAll: (_input, request) => stopAll(request.signal),
    });
    return () => registration.dispose();
  },
});

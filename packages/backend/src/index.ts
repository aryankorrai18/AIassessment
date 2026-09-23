import { env } from "./config/env";
import { createApp } from "./app";
import { logger } from "./lib/logger";
import { startSweeps } from "./services/sweeps";

createApp().listen(env.port, () => {
  logger.info(`GapVise backend listening on :${env.port}`);
  if (process.env.DISABLE_SWEEPS !== "true") startSweeps();
});

// @flow
// Synchronize the local database with distant service
import { getCurrentDatabase } from "./db";
import { prefetchAllPairExchanges, pullLiveRates } from "./cache";
import { pullLiveRatesError, pullLiveRatesEnd } from "./logger";
import { recurrentJob } from "./utils";

const rebootTimeIfError = 60 * 1000;
const rebootTimeIfComplete = 30 * 1000;
const autoRebootHangTime = 10 * 1000;
const autoRebootInterval = 4 * 60 * 60 * 1000;

getCurrentDatabase()
  .init()
  .then(() => {
    function pullLoop() {
      const sub = pullLiveRates(
        error => {
          pullLiveRatesError(error);
          setTimeout(pullLoop, rebootTimeIfError);
        },
        () => {
          pullLiveRatesEnd();
          setTimeout(pullLoop, rebootTimeIfComplete);
        }
      );
      setTimeout(() => {
        sub.unsubscribe();
        setTimeout(pullLoop, autoRebootHangTime);
      }, autoRebootInterval);
    }

    pullLoop();

    if (!process.env.DISABLE_PREFETCH) {
      recurrentJob(prefetchAllPairExchanges, 4 * 60 * 60 * 1000);
    }
  });

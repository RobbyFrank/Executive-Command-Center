import { KvTrackerStorage } from "./tracker-storage";
import { TrackerRepositoryCore } from "./tracker-repository-core";

/** Upstash Redis–backed repository (e.g. Vercel Storage / marketplace). */
export class KvTrackerRepository extends TrackerRepositoryCore {
  constructor() {
    super(new KvTrackerStorage());
  }
}

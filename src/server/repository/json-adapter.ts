import { FileTrackerStorage } from "./tracker-storage";
import { TrackerRepositoryCore } from "./tracker-repository-core";

/** Local `data/tracker.json` repository (development and single-machine deploys). */
export class JsonTrackerRepository extends TrackerRepositoryCore {
  constructor() {
    super(new FileTrackerStorage());
  }
}

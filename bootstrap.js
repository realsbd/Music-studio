import { showLoadError } from './loading.js';

// Catch startup failures (including unavailable WebGL), as well as failures
// downloading the scene. All runtime modules are served by the deployment.
import('./main.js').catch(showLoadError);

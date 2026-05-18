/**
 * Deprecated standalone entry point for publications generation.
 *
 * The canonical generator now lives at
 * `scripts/generators/publications-generator.js` (the one `collect-all.js`
 * runs). This file previously duplicated that logic and drifted out of sync;
 * it is kept only so `node scripts/generate-publications.js` still works, and
 * simply delegates to the canonical implementation.
 */

const { generatePublicationsData } = require('./generators/publications-generator');

generatePublicationsData()
  .then((success) => {
    console.log(
      success
        ? 'Publications generation completed successfully'
        : 'Publications generation failed or was skipped'
    );
    process.exit(success ? 0 : 1);
  })
  .catch((error) => {
    console.error('Error in publications generation:', error);
    process.exit(1);
  });

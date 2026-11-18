import { createRsbuildConfig, extendRsbuildConfig } from '../../config-tools.js';

/**
 * Warning!
 *
 * Remember to update this.#registerDiff() calls when adding/removing quasarConf
 * properties needed for the build.
 */
export const quasarSpaConfig = {
  rsbuild: async quasarConf =>
  {
    const cfg = await createRsbuildConfig(quasarConf, {
      compileId: 'rsbuild-spa',
      shippedToClient: true
    });

    return extendRsbuildConfig(cfg, quasarConf, { isClient: true });
  }
};

export const modeConfig = quasarSpaConfig;

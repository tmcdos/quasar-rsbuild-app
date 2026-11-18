import { createRsbuildConfig, extendRsbuildConfig } from '../../config-tools.js';
import { quasarRsbuildPluginDevCordovaPlatformInject } from './rsbuild-plugin.dev.cordova-platform-inject.js';

/**
 * Warning!
 *
 * Remember to update this.#registerDiff() calls when adding/removing quasarConf
 * properties needed for the build.
 */
const quasarCordovaConfig = {
  rsbuild: async quasarConf =>
  {
    const cfg = await createRsbuildConfig(quasarConf, {
      compileId: 'rsbuild-cordova',
      shippedToClient: true
    });

    if (quasarConf.ctx.dev)
    {
      cfg.plugins.unshift(quasarRsbuildPluginDevCordovaPlatformInject(quasarConf));
    }
    else
    {
      cfg.output.distPath = quasarConf.ctx.appPaths.resolve.cordova('www');
    }

    return extendRsbuildConfig(cfg, quasarConf, { isClient: true });
  }
};

const modeConfig = quasarCordovaConfig;

export { modeConfig, quasarCordovaConfig };

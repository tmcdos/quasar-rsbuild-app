import { join } from 'node:path';

import {
  applyWin32NestedAliasQuirk,
  createBrowserRolldownConfig,
  createRsbuildConfig,
  extendRolldownConfig,
  extendRsbuildConfig
} from '../../config-tools.js';

function generateDefaultEntry(quasarConf)
{
  return {
    name: 'file', // or subdir/file (regardless of OS)
    from: quasarConf.ctx.appPaths.resolve.bex('file.js'),
    to: join(quasarConf.build.distDir, 'file.js')
  };
}

/**
 * Warning!
 *
 * Remember to update this.#registerDiff() calls when adding/removing quasarConf
 * properties needed for the build.
 */
export const quasarBexConfig = {
  rsbuild: async quasarConf =>
  {
    const cfg = await createRsbuildConfig(quasarConf, {
      compileId: 'rsbuild-bex',
      shippedToClient: true
    });
    if (quasarConf.ctx.prod || quasarConf.ctx.target.firefox)
    {
      cfg.output.distPath = join(quasarConf.build.distDir, 'www');
    }

    return extendRsbuildConfig(cfg, quasarConf, { isClient: true });
  },

  bexScript(quasarConf, entry = generateDefaultEntry(quasarConf))
  {
    const cfg = createBrowserRolldownConfig(quasarConf, {
      shippedToClient: true
    });

    applyWin32NestedAliasQuirk(cfg, ['bex/background', 'bex/content']);

    cfg.transform.define = {
      ...cfg.transform.define,
      'import.meta.env.QUASAR_BEX_SCRIPT_NAME': `"${entry.name}"`
    };

    cfg.external = Object.keys(quasarConf.ctx.pkg.bexPkg.dependencies || {});

    if (quasarConf.ctx.dev)
    {
      Object.assign(cfg.transform.define, {
        'import.meta.env.QUASAR_BEX_SERVER_PORT': String(quasarConf.devServer.port || 0)
      });
    }

    cfg.input = entry.from;
    cfg.output.file = entry.to;

    return extendRolldownConfig(
      cfg,
      quasarConf.bex,
      quasarConf.ctx,
      'extendBexScriptsConf'
    );
  }
};

export const modeConfig = quasarBexConfig;

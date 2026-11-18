import { join } from 'node:path';

import { mergeRsbuildConfig } from '@rsbuild/core';

import {
  createNodeRolldownConfig,
  createRsbuildConfig,
  extendRolldownConfig,
  extendRsbuildConfig
} from '../../config-tools.js';
import { quasarRolldownVueShimPlugin } from '../../plugins/rolldown.vue-shim.js';
import { cliDir, cliPkg } from '../../utils/cli-runtime.js';
import { getPackagePath } from '../../utils/get-package-path.js';
import { quasarPwaConfig } from '../pwa/pwa-config.js';
import { quasarRsbuildPluginPwaResources } from '../pwa/pwa-utils.js';

/**
 * Warning!
 *
 * Remember to update this.#registerDiff() calls when adding/removing quasarConf
 * properties needed for the build.
 */
export const quasarSsgConfig = {
  rsbuildClient: async quasarConf =>
  {
    let cfg = await createRsbuildConfig(quasarConf, {
      compileId: 'rsbuild-ssg-client',
      shippedToClient: true,
      /**
       * We specify modeDeps because the SW register file
       * is part of the /src build and it uses dependencies
       * from /src-pwa.
       */
      modeDeps: quasarConf.ssg.pwa
        ? [{
            dir: 'src-pwa',
            deps: quasarConf.ctx.pkg.pwaPkg.dependencies
          }]
        : void 0
    });
    const { appPaths } = quasarConf.ctx;

    cfg = mergeRsbuildConfig(cfg, {
      source:
        {
          define:
          {
            'import.meta.env.QUASAR_CLIENT': 'true',
            'import.meta.env.QUASAR_SERVER': 'false',
            __QUASAR_SSR_PWA__: String(Boolean(quasarConf.ssg.pwa))
          },
        },
      output:
        {
          target: 'web',
          manifest: true,
          distPath: quasarConf.build.distDir
        }
    });

    // also update pwa-config.js & ssr-config.js when changing here
    if (quasarConf.ssg.pwa)
    {
      cfg.plugins.push(quasarRsbuildPluginPwaResources(quasarConf));
    }

    // dev has js entry-point, while prod has index.html
    if (quasarConf.ctx.dev)
    {
      cfg.source.entry ||= {};
      cfg.source.entry.index = appPaths.resolve.entry('client-entry.js');
    }

    return extendRsbuildConfig(cfg, quasarConf, { isClient: true });
  },

  rsbuildServer: async quasarConf =>
  {
    let cfg = await createRsbuildConfig(quasarConf, {
      compileId: 'rsbuild-ssg-server',
      shippedToClient: false,
      /**
       * We specify modeDeps because the SW register file
       * is part of the /src build and it uses dependencies
       * from /src-pwa.
       */
      modeDeps: quasarConf.ssg.pwa
        ? [{
            dir: 'src-pwa',
            deps: quasarConf.ctx.pkg.pwaPkg.dependencies
          }]
        : void 0
    });

    const { appPaths } = quasarConf.ctx;
    const ssrEntryFile = appPaths.resolve.entry('server-entry.js');

    cfg = mergeRsbuildConfig(cfg, {
      source:
        {
          define:
          {
            'import.meta.env.QUASAR_CLIENT': 'false',
            'import.meta.env.QUASAR_SERVER': 'true',
            __QUASAR_SSR_PWA__: String(Boolean(quasarConf.ssg.pwa))
          },
          entry:
            {
              index: ssrEntryFile
            }
        },
      output:
      {
        target: 'node',
        autoExternal:
          {
            dependencies: true,
            optionalDependencies: true,
            peerDependencies: true,
            devDependencies: true,
            // we don't externalize ourselves because of
            // the possible imports of '#q-app' / 'quasar-rsbuild-app' wrappers
            exclude: [cliPkg.name],
          },
        distPath: join(quasarConf.build.distDir, '__ssg__'),
      }
    });

    return extendRsbuildConfig(cfg, quasarConf, { isServer: true });
  },

  // returns a Promise
  ssgRenderer: quasarConf =>
  {
    // returning null for the "inspect" cmd
    // otherwise this fn won't be called if not needed anyway
    if (!quasarConf.ctx.prod)
    {
      return null;
    }

    const cfg = createNodeRolldownConfig(quasarConf, {
      compileId: 'ssg-script',
      format: 'esm',
      shippedToClient: false
    });
    const { appPaths } = quasarConf.ctx;

    cfg.transform.define = {
      ...cfg.transform.define,
      'import.meta.env.QUASAR_CLIENT': 'false',
      'import.meta.env.QUASAR_SERVER': 'true'
    };

    cfg.input = appPaths.resolve.entry('ssg-script.js');
    cfg.output.file = join(quasarConf.build.distDir, '__ssg__/ssg-script.js');

    cfg.external.push(
      ...Object.keys(quasarConf.ctx.pkg.appPkg.dependencies || {}),
      ...Object.keys(quasarConf.ctx.pkg.ssgPkg.dependencies || {}),
      'vue/server-renderer',
      'vue/compiler-sfc',
      './render-template.js',
      './quasar.manifest.json',
      './server-entry.js'
    );

    if (
      quasarConf.metaConf.hasStore &&
      quasarConf.ssg.manualStoreSerialization !== true
    )
    {
      cfg.resolve.alias['#q-serialize-javascript'] = getPackagePath(
        'serialize-javascript',
        cliDir
      );
    }

    cfg.resolve.modules = ['node_modules', appPaths.resolve.ssg('node_modules')];

    cfg.plugins ||= [];
    cfg.plugins.push(quasarRolldownVueShimPlugin());

    return extendRolldownConfig(
      cfg,
      quasarConf.ssg,
      quasarConf.ctx,
      'extendSSGRendererConf'
    );
  },

  workbox: quasarConf =>
  {
    // returning null for the "inspect" cmd
    // otherwise this fn won't be called if not needed anyway
    if (!quasarConf.ssg.pwa)
    {
      return null;
    }

    return quasarPwaConfig.workbox(quasarConf);
  },

  customSw: quasarConf =>
  {
    if (
      !quasarConf.ssg.pwa ||
      quasarConf.pwa.workboxMode !== 'InjectManifest'
    )
    {
      // returning null for the "inspect" cmd
      // otherwise this fn won't be called if not needed anyway
      return null;
    }

    return quasarPwaConfig.customSw(quasarConf);
  }
};

export const modeConfig = quasarSsgConfig;

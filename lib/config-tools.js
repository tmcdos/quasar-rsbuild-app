import { readFileSync } from 'node:fs';
import { join, normalize, relative, resolve } from 'node:path';

import { mergeRsbuildConfig } from '@rsbuild/core';
import { pluginSass } from '@rsbuild/plugin-sass';
import { pluginVue } from '@rsbuild/plugin-vue';
import transformAssetUrls from 'quasar/dist/transforms/loader-asset-urls.json' with { type: 'json' };
import { merge } from 'rspack-merge';
import { globSync } from 'tinyglobby';

import QuasarLoaderPlugin from './loaders/vue/quasar-loader.mjs';
import { isModeInstalled } from './modes/modes-utils.js';
import { quasarRsbuildIndexHtmlTransformPlugin } from './plugins/rsbuild.html.js';
import {
  BASELINE_WIDELY_AVAILABLE,
  BASELINE_WIDELY_AVAILABLE_TARGET_STRING
} from './utils/build-targets.js';
import { getPackage } from './utils/get-package.js';
import { tip, warn } from './utils/logger.js';

const compileIdToRunModeMap = {
  'rsbuild-ssr-client': 'ssr-client',
  'rsbuild-ssr-server': 'ssr-server',
  'rsbuild-ssg-client': 'ssr-client',
  'rsbuild-ssg-server': 'ssr-server'
};

async function parseRsbuildPlugins(entries, appDir, compileId)
{
  const acc = [];
  let showTip = false;

  for (const entry of entries)
  {
    if (!entry)
    {
      // example:
      // [
      //   ctx.dev ? [ ... ] : null,
      //   // ...
      // ]
      continue;
    }

    if (!Array.isArray(entry))
    {
      if (typeof entry === 'function')
      {
        showTip = true;
      }

      acc.push(entry);
      continue;
    }

    const [name, pluginOpts = {}, runOpts = {
      client: true,
      server: true
    }] =
      entry;

    if (compileId === 'rsbuild-ssr-server' || compileId === 'rsbuild-ssg-server')
    {
      // if it's configured to not run on server, then skip it
      if (runOpts.server === false)
      {
        continue;
      }
    }
    else if (runOpts.client === false)
    {
      // if it's configured to not run on client, then skip it
      continue;
    }

    if (typeof name === 'function')
    {
      acc.push(
        // protect against the Rsbuild plugin mutating its own options and triggering endless cfg diff loop
        name(merge({}, pluginOpts))
      );
      continue;
    }

    if (Object(name) === name)
    {
      acc.push(
        // protect against the Rsbuild plugin mutating its own options and triggering endless cfg diff loop
        merge({}, name)
      );
      continue;
    }

    if (typeof name !== 'string')
    {
      warn('quasar.config file > invalid Rsbuild plugin specified: ' + name);
      warn("Correct form: [ 'my-vite-plugin-name', { /* pluginOpts */ } ] or [ pluginFn, { /* pluginOpts */ } ]");
      continue;
    }

    const plugin = await getPackage(name, appDir);

    if (!plugin)
    {
      warn('quasar.config file > invalid Rsbuild plugin specified (could not find it): ' + name);
      continue;
    }

    const pluginFn =
      plugin.default?.default ||
      plugin.default ||
      plugin;

    acc.push(
      pluginFn(
        // protect against the Rsbuild plugin mutating its own options and triggering endless cfg diff loop
        merge({}, pluginOpts)
      )
    );
  }

  if (showTip)
  {
    tip(
      'If you want changes to quasar.config file > build > rsbuildPlugins to be picked up,' +
        ' specify them in this form:' +
        "[ [ 'plugin-name', { /* pluginOpts */ }, { client: true, server: true } ], ... ]" +
        ' or [ [ pluginFn, { /* pluginOpts */ }, { client: true, server: true } ], ... ]'
    );
  }

  return acc;
}

/**
 * Deps installed in a /src-<modeName> folder instead of the app root
 * would otherwise not be resolvable by Rsbuild from /src code.
 *
 * Capacitor deps are aliased in EVERY mode (not just Capacitor mode):
 * Capacitor plugins ship web implementations, so shared /src code may
 * import them guarded by import.meta.env.QUASAR_CAPACITOR_MODE (the
 * guarded branch is dead-code eliminated in production builds). #17681
 * The types-generator mirrors this by adding these deps to
 * compilerOptions.paths whenever Capacitor mode is installed.
 *
 * Exported for testing purposes.
 */
export function getModeDepsAliases(appPaths, pkg, modeDeps)
{
  const acc = {};

  const injectDeps = ({ dir, deps }) =>
  {
    if (!deps)
    {
      return;
    }

    // dir is of type: "src-<modeName>", example: "src-pwa"
    const target = appPaths.resolve.app(`${dir}/node_modules`);

    Object.keys(deps).forEach(depName =>
    {
      acc[depName] = join(target, depName);
    });
  };

  if (isModeInstalled(appPaths, 'capacitor'))
  {
    injectDeps({
      dir: 'src-capacitor',
      deps: pkg.capacitorPkg.dependencies
    });
  }

  // specified last so that a mode's own deps win on any name clash
  modeDeps?.forEach(injectDeps);

  return acc;
}

/**
 * Warning!
 *
 * Remember to update this.#registerDiff() calls when adding/removing quasarConf
 * properties needed for the build.
 */
// the dep scanner externalizes virtual modules, so with filename-based
// routing it never gets past vue-router/auto-routes to the (lazy) page
// components; the routes folders are scanned directly instead
export function getFilenameBasedRoutingScanEntries(
  filenameBasedRouting,
  appDir
)
{
  if (!filenameBasedRouting)
  {
    return [];
  }

  // same defaults as vue-router's Vite plugin
  const {
    root = appDir,
    routesFolder = 'src/pages',
    extensions = ['.vue']
  } = filenameBasedRouting;

  return (Array.isArray(routesFolder) ? routesFolder : [routesFolder]).flatMap(
    folder =>
    {
      const { src, extensions: folderExtensions = extensions } = typeof folder === 'string' ? { src: folder } : folder;
      const dir = normalize(relative(appDir, resolve(root, src)));
      return folderExtensions.map(ext => `${dir}/**/*${ext}`);
    }
  );
}

/**
 * Generate devServer configuration object for rsBuild based on quasar.config
 * @param {import ('@rsbuild/core').RsbuildConfig} rsbuildConfig
 * @param {import ('../types/configuration/conf').QuasarConf} quasarConfig
 */
function configureDevServer(rsbuildConfig, quasarConfig)
{
  rsbuildConfig.server = {
    host: quasarConfig.devServer?.host || '0.0.0.0',
    port: quasarConfig.devServer?.port || 9000,
    base: quasarConfig.build?.publicPath || '/',
    publicDor:
      {
        name: quasarConfig.devServer?.static?.directory || 'public',
      }
  };
  if (quasarConfig.build?.historyApiFallback)
  {
    rsbuildConfig.server.historyApiFallback = true;
  }
  if (quasarConfig.devServer?.server?.type === 'https' && quasarConfig.devServer?.server?.options)
  {
    rsbuildConfig.server.https = {};
    for (const sslType in quasarConfig.devServer.server.options)
    {
      rsbuildConfig.server.https[sslType] = readFileSync(quasarConfig.devServer.server.options[sslType]);
    }
  }

  // configure dev proxy
  if (quasarConfig.devServer?.proxy && Array.isArray(quasarConfig.devServer.proxy))
  {
    rsbuildConfig.server.proxy = {};
    quasarConfig.devServer.proxy.forEach(item =>
    {
      const proxyPath = typeof item.context === 'string' ? item.context : (item.context || [])[0];
      rsbuildConfig.server.proxy[proxyPath] = item;
    });
  }
}

export async function createRsbuildConfig(
  quasarConf,
  {
    compileId,
    shippedToClient,
    modeDeps = null // support for modes with their own package.json
  }
)
{
  const { ctx, build, metaConf } = quasarConf;
  const { appPaths } = ctx;

  //const cacheDir = appPaths.resolve.cache(compileId);

  // protect against Rsbuild mutating its own options and triggering endless cfg diff loop
  const vueRsbuildPluginOptions = merge({
    vueLoaderOptions:
      {
        transformAssetUrls,
      }
  }, build.rsbuildVuePluginOptions);

  let jsxPlugin = [
    pluginVue(vueRsbuildPluginOptions),
  ];
  if (build.vueJsx)
  {
    const { pluginBabel } = await import('@rsbuild/plugin-babel');
    const { pluginVueJsx } = await import('@rsbuild/plugin-vue-jsx');
    jsxPlugin = [
      pluginBabel({
        include: /\.(?:jsx|tsx)$/,
      }),
      pluginVue(vueRsbuildPluginOptions),
      pluginVueJsx(),
    ];
  }

  /**
   * @type {import('@rsbuild/core').RsbuildConfig}
   */
  const rsbuildConf = {
    // also used by "inspect" cmd to determine if it's a rsBuild config or not:
    source:
      {
        tsconfigPath: './jsconfig.json',
        define:
          {
            ...metaConf[
              shippedToClient ? 'clientEnvDefineList' : 'backendEnvDefineList'
            ],
            ...build.define
          },
        entry:
          {
            index: normalize(
              relative(
                appPaths.appDir,
                quasarConf.metaConf.entryScript.absolutePath
              )
            ),
          }
      },

    resolve:
      {
        alias:
        {
          ...build.alias
        }
      },

    build:
      {
        target: compileId === 'rsbuild-ssr-server' || compileId === 'rsbuild-ssg-server'
          ? 'node'
          : 'web',
        //minify: build.minify,
        //sourcemap: build.sourcemap
      },

    html:
    {
      mountId: 'q-app',
      template: 'index.html',
    },

    tools:
      {
        lightningcssLoader:
          {
            errorRecovery: false,
          },
        bundlerChain: (chain, utils) =>
        {
          // custom loader to import SVG as Vue components
          const ruleSvg = chain.module.rule(utils.CHAIN_ID.RULE.SVG).test(/\.svg$/);

          ruleSvg
            .oneOf('svg-vue')
            .before(utils.CHAIN_ID.ONE_OF?.SVG_URL) // Priority matters
            .type('javascript/auto')
            .resourceQuery(new RegExp('(^|\\?)' + (quasarConf.svgQuery || 'int') + '($|&)')) // component SVGs must be in the form src="@/images/example.svg?int" !!!!!
            .use('vue-svg-loader')
            .loader(resolve(__dirname, './loaders/svg/svg-loader.mjs'))
            .options({
              svgo:
                {
                  plugins: [
                    {
                      name: 'preset-default',
                      params:
                        {
                          overrides:
                            {
                              inlineStyles:
                                {
                                  onlyMatchedOnce: false
                                },
                            }
                        }
                    },
                    'prefixIds',
                    'removeDimensions',
                  ]
                }
            });

          if (typeof quasarConf.build?.bundlerChain === 'function')
          {
            quasarConf.build?.bundlerChain(chain, utils);
          }
        }
      },

    output:
      {
        distPath:
          {
            root: build.distDir,
            js: 'js',
            jsAsync: 'js',
            css: 'css',
            cssAsync: 'css',
            image: 'image',
            svg: 'image',
            font: 'font',
            wasm: 'wasm',
            media: 'media',
            assets: 'assets',
          },
        sourceMap:
          {
            css: ctx.dev || !!build.sourceMap,
            js: ctx.dev ? 'cheap-module-source-map' : build.sourceMap === 'hidden' ? 'hidden-source-map' : build.sourceMap ? 'source-map' : false,
          }
      },

    plugins: jsxPlugin.concat([
      pluginSass({
        sassLoaderOptions:
          {
            sourceMap: ctx.dev || !!build.sourceMap,
            implementation: 'sass', // sass-embedded is not a valid Win32 application
            sassOptions:
              {
                charset: false, // IMPORTANT - otherwise it emits BOM mark after processing quasar.sass and this breaks lightningcss-loader (it either complains on *,*:before,*:after declaration or silently skips it if errorRecovery = true - the default)
                quietDeps: true, // ignore @import deprecation warning
                silenceDeprecations: ['import', 'global-builtin'],
              }
          },
      }),
      ...QuasarLoaderPlugin({
        runMode: compileIdToRunModeMap[compileId] || 'web-client',
        autoImportComponentCase: quasarConf.framework.autoImportComponentCase,
        autoImportVueExtensions: quasarConf.framework.autoImportVueExtensions,
        autoImportScriptExtensions: quasarConf.framework.autoImportScriptExtensions,
        devTreeshaking: Boolean(quasarConf.framework.devTreeshaking),
        sassVariables: quasarConf.metaConf.css.variablesFile,
      }),
      ...(await parseRsbuildPlugins(build.rsbuildPlugins, appPaths.appDir, compileId))
    ]),
  };

  const { filenameBasedRouting } = quasarConf.build;
  if (filenameBasedRouting)
  {
    const vueRouterVite = await ctx.cacheProxy.getModule('vueRouter');
    rsbuildConf.plugins.unshift(
      vueRouterVite({
        // protect against the Vite plugin mutating its own options
        // and triggering endless cfg diff loop
        ...filenameBasedRouting
      })
    );
    getFilenameBasedRoutingScanEntries(
      quasarConf.build.filenameBasedRouting,
      appPaths.appDir
    ).forEach(globPattern =>
    {
      const entryFiles = globSync(globPattern);
      entryFiles.forEach(file =>
      {
        rsbuildConf.source.entry[file] = file;
      });
    });
  }

  if (compileId !== 'rsbuild-ssr-server' && compileId !== 'rsbuild-ssg-server')
  {
    rsbuildConf.plugins.unshift(quasarRsbuildIndexHtmlTransformPlugin(quasarConf));

    if (ctx.prod && quasarConf.build.useFilenameHashes !== true)
    {
      rsbuildConf.output.filenameHash = false;
    }
  }

  if (ctx.dev)
  {
    if (compileId !== 'rsbuild-ssr-server' && compileId !== 'rsbuild-ssg-server')
    {
      if (quasarConf.metaConf.vueDevtoolsOptions)
      {
        const rsbuildPluginVueDevtools = await ctx.cacheProxy.getModule('vueDevtools');

        rsbuildConf.plugins.push(
          rsbuildPluginVueDevtools({
            // protect against the Rsbuild plugin mutating its own options
            // and triggering endless cfg diff loop
            ...quasarConf.metaConf.vueDevtoolsOptions
          })
        );
      }

      configureDevServer(rsbuildConf, quasarConf.devServer);
    }
    else
    {
      configureDevServer(rsbuildConf, quasarConf.devServer);
    }
  }

  Object.assign(
    rsbuildConf.resolve.alias,
    getModeDepsAliases(appPaths, ctx.pkg, modeDeps)
  );

  return rsbuildConf;
}

export async function extendRsbuildConfig(rsbuildConf, quasarConf, invokeParams)
{
  const opts = {
    isClient: false,
    isServer: false,
    ...invokeParams
  };

  if (typeof quasarConf.build.extendRsbuildConf === 'function')
  {
    const overrides = await quasarConf.build.extendRsbuildConf(rsbuildConf, opts);
    if (Object(overrides) === overrides)
    {
      rsbuildConf = mergeRsbuildConfig(rsbuildConf, overrides);
    }
  }

  await quasarConf.ctx.appExt.runAppExtensionHook(
    'extendRsbuildConf',
    async hook =>
    {
      hook.api.logger.log(`Extending Rsbuild config`);
      const overrides = await hook.fn(rsbuildConf, opts, hook.api);
      if (Object(overrides) === overrides)
      {
        rsbuildConf = mergeRsbuildConfig(rsbuildConf, overrides);
      }
    }
  );

  return rsbuildConf;
}

/**
 * Warning!
 *
 * Remember to update this.#registerDiff() calls when adding/removing quasarConf
 * properties needed for the build.
 */
export function createNodeRolldownConfig(
  quasarConf,
  { format, shippedToClient }
)
{
  return {
    platform: 'node',
    tsconfig: false,

    output:
    {
      format,
      codeSplitting: false,
      minify: quasarConf.build.minify,
      sourcemap: quasarConf.build.sourcemap,
      cleanDir: false
    },

    resolve:
    {
      alias:
      {
        ...quasarConf.build.alias
      },
      extensions:
        format === 'esm'
          ? ['.js', '.ts', '.json', '.jsx', '.tsx']
          : ['.cjs', '.js', '.ts', '.json', '.jsx', '.tsx']
    },

    /**
     * Required for Windows host, otherwise Node.js will complain
     * about importing with absolute paths and will fail with
     * ESM error ("ERR_UNSUPPORTED_ESM_URL_SCHEME"):
     */
    makeAbsoluteExternalsRelative: true,
    external: quasarConf.ctx.dev ? [/node_modules/] : [],

    transform:
    {
      target: quasarConf.build.target.node,
      define:
      {
        ...quasarConf.metaConf[
          shippedToClient ? 'clientEnvDefineList' : 'backendEnvDefineList'
        ],
        ...quasarConf.build.define
      }
    }
  };
}

/**
 * Required for Windows host, otherwise Rolldown will fail to build
 * because it reports that the matched alias "#q-app/<subPath>"
 * cannot be resolved (even though the "#q-app" alias is defined).
 * The order of aliases also matters, as '#q-app' needs to be defined
 * only after the more specific ones.
 *
 * @param {object} rolldownConf
 * @param {string[]} subPathList - "quasar-rsbuild-app" export sub-paths
 *   (without the leading "./") that the compiled script may import
 */
export function applyWin32NestedAliasQuirk(rolldownConf, subPathList)
{
  if (process.platform !== 'win32')
  {
    return;
  }

  const alias = {};
  for (const subPath of subPathList)
  {
    alias[`#q-app/${subPath}`] = `quasar-rsbuild-app/${subPath}`;
  }

  rolldownConf.resolve.alias = {
    ...alias,
    ...rolldownConf.resolve.alias
  };
}

/**
 * Warning!
 *
 * Remember to update this.#registerDiff() calls when adding/removing quasarConf
 * properties needed for the build.
 */
export function createBrowserRolldownConfig(quasarConf, { shippedToClient })
{
  const { browser } = quasarConf.build.target;
  const target =
    browser === BASELINE_WIDELY_AVAILABLE_TARGET_STRING
      ? [...BASELINE_WIDELY_AVAILABLE]
      : structuredClone(browser);

  return {
    platform: 'browser',
    tsconfig: false,

    output:
    {
      format: 'iife',
      codeSplitting: false,
      minify: quasarConf.build.minify,
      sourcemap: quasarConf.build.sourcemap,
      cleanDir: false
    },

    resolve:
    {
      alias:
      {
        ...quasarConf.build.alias
      }
    },

    transform:
    {
      target,
      // same JSX/TSX handling as the Vite pipeline (see createViteConfig),
      // for the browser-targeted scripts built by Rolldown alone
      // (BEX scripts, the custom PWA service worker)
      ...(quasarConf.build.vueJsx ? { jsx: quasarConf.build.vueJsx } : {}),
      define:
      {
        ...quasarConf.metaConf[
          shippedToClient ? 'clientEnvDefineList' : 'backendEnvDefineList'
        ],
        ...quasarConf.build.define
      }
    },

    plugins: []
  };
}

export async function extendRolldownConfig(
  rolldownConfig,
  quasarConfTarget,
  ctx,
  methodName
)
{
  // example: quasarConf.ssr.extendSSRWebserverConf
  if (typeof quasarConfTarget[methodName] === 'function')
  {
    const overrides = await quasarConfTarget[methodName](rolldownConfig);
    if (Object(overrides) === overrides)
    {
      rolldownConfig = merge({}, rolldownConfig, overrides);
    }
  }

  await ctx.appExt.runAppExtensionHook(methodName, async hook =>
  {
    hook.api.logger.log(`Running "${methodName}(rolldownConfig)"`);
    const overrides = await hook.fn(rolldownConfig, hook.api);
    if (Object(overrides) === overrides)
    {
      rolldownConfig = merge({}, rolldownConfig, overrides);
    }
  });

  /**
   * Avoid "import.meta.env is not defined"
   * as this is not available in Node.js.
   *
   * Should be the last statement in "define",
   * otherwise it will override all previous statements.
   */
  // eslint-disable-next-line require-atomic-updates
  rolldownConfig.transform.define['import.meta.env'] = '{}';

  return rolldownConfig;
}

import { normalize } from 'node:path';

import {
  createScssTransform,
  createVariablesManager
} from '../sass/scss-transform.mjs';
import {
  hasResidualQuasarImports,
  loadQuasarImportMap,
  mapQuasarImports
} from './js-transform.mjs';
import { createExtMatcher, parseRsbuildRequest } from './query.mjs';
import { setRsbuildConfig } from './rsbuild-config.mjs';
import { createQuasarNodeTransform } from './vue-ast-transform.mjs';
import { vueTransform } from './vue-transform.mjs';

const defaultOptions = {
  runMode: 'web-client',
  sassVariables: true,
  devTreeshaking: false,
  astAutoImport: true,
  autoImportComponentCase: 'kebab',
  autoImportVueExtensions: ['vue'],
  autoImportScriptExtensions: ['js', 'jsx', 'ts', 'tsx']
};
const defaultOptionsKeys = Object.keys(defaultOptions);

const rawQueryRegex = /[?&]raw(?:&|$)/;
const quasarCodeRegex = /_resolveComponent\(|_resolveDirective\(|['"]quasar['"]/;

function parsePluginOptions(userOpts = {})
{
  const opts = { ...userOpts };

  for (const key of defaultOptionsKeys)
  {
    if (opts[key] === void 0)
    {
      opts[key] = defaultOptions[key];
    }
  }

  return opts;
}

function getConfigPlugin(opts)
{
  return {
    name: 'rsbuild:quasar:rsbuild-conf',

    /**
     * @param {import('@rsbuild/core').RsbuildPluginAPI} api
     */
    setup(api)
    {
      api.modifyRsbuildConfig((config, { isDev }) =>
      {
        setRsbuildConfig(
          opts.runMode,
          isDev,
          config
        );
      });
      const vueCfg = api.getNormalizedConfig().plugins.find(entry => entry.name === 'rsbuild:vue');

      if (vueCfg === void 0)
      {
        throw new Error('[Quasar] In your Vite config file, please add the Quasar plugin ** after ** the Vue one');
      }
    }
  };
}

const scssMatcher = createExtMatcher(['scss', 'module.scss']);
const sassMatcher = createExtMatcher(['sass', 'module.sass']);

function getScssTransformsPlugin(opts)
{
  const sassVariables =
    typeof opts.sassVariables === 'string'
      ? normalize(opts.sassVariables)
      : opts.sassVariables;

  const manager = createVariablesManager(sassVariables);
  const scssTransform = createScssTransform('scss', sassVariables, manager);
  const sassTransform = createScssTransform('sass', sassVariables, manager);

  return {
    name: 'rsbuild:quasar:scss',
    enforce: 'pre',
    /**
     * @param {import('@rsbuild/core').RsbuildPluginAPI} api
     */
    setup(api)
    {
      api.transform({ test: /\.s[ac]ss(?:\?|$)/ }, context =>
      {
        if (!rawQueryRegex.test(context.resource))
        {
          const is = parseRsbuildRequest(context);

          if (is.style(scssMatcher))
          {
            return scssTransform(context, this);
          }

          if (is.style(sassMatcher))
          {
            return sassTransform(context, this);
          }
        }
      });
      api.modifyRsbuildConfig(resolvedConfig =>
      {
        manager.setCacheRoot(resolvedConfig.root);
      });
    }
  };
}

function getScriptTransformsPlugin(opts)
{
  let useTreeshaking = true;
  let astAutoImportActive = false;

  const vueMatcher = createExtMatcher(opts.autoImportVueExtensions);
  const scriptMatcher = createExtMatcher(opts.autoImportScriptExtensions);

  const warnedFiles = new Set();

  function warnResidualImports(logger, code, id)
  {
    if (
      useTreeshaking &&
      !warnedFiles.has(id) &&
      hasResidualQuasarImports(code, id)
    )
    {
      warnedFiles.add(id);
      const msg =
        `[Quasar] "${id}" contains an import from "quasar" that could not be` +
        ' transformed into per-file imports, so the full Quasar bundle may' +
        ' end up in your build output';

      if (typeof logger === 'function')
      {
        logger.warn(msg);
      }
      else
      {
        console.warn(msg);
      }
    }
  }

  /**
   * @param {import('@rsbuild/core').TransformContext} context
   * @param {import('@rsbuild')} logger
   * @returns {null|{code: *, map: null}}
   */
  function transformHandler(context, logger)
  {
    // when hook filters are not available, this mirrors their fast bail out
    if (!quasarCodeRegex.test(context.code))
    {
      return null;
    }

    const is = parseRsbuildRequest(context);

    // the regex fallback post-processes the compiled render code,
    // so template requests need their own handling there
    if (astAutoImportActive === false && is.template(vueMatcher))
    {
      const code = vueTransform(
        context.code,
        opts.autoImportComponentCase,
        useTreeshaking
      );

      warnResidualImports(logger, code, context.resource);

      return code === context.code
        ? null
        : {
            code,
            map: null // the transformations preserve line positions
          };
    }

    // with the AST transform active, components and directives are
    // already resolved at template compile time, which leaves Vue SFCs
    // with the same needs as any script file: mapping user-written
    // "quasar" imports to per-file paths when treeshaking
    if (
      useTreeshaking &&
      (is.script(scriptMatcher) || is.template(vueMatcher))
    )
    {
      const code = mapQuasarImports(context.code);

      warnResidualImports(logger, code, context.resource);

      return code === context.code
        ? null
        : {
            code,
            map: null // the transformations preserve line positions
          };
    }

    return null;
  }

  return {
    name: 'rsbuild:quasar:script',
    /**
     * @param {import('@rsbuild/core').RsbuildPluginAPI} api
     */
    setup(api)
    {
      api.transform({
        test: new RegExp(`\\.(?:${opts.autoImportVueExtensions.concat(opts.autoImportScriptExtensions).join('|')})(?:\\?|$)`),
        codeFilter: quasarCodeRegex,
      }, context =>
      {
        if (!rawQueryRegex.test(context.resource))
        {
          transformHandler(context, api.logger);
        }
      });
      if (opts.astAutoImport === true)
      {
        if (!opts.devTreeshaking && api.context.action !== 'build')
        {
          useTreeshaking = false;
        }
        else
        {
          loadQuasarImportMap();
        }
        astAutoImportActive = true;
        api.modifyBundlerChain((chain, { CHAIN_ID }) =>
        {
          // Check if the Vue rule added by @rsbuild/plugin-vue exists
          if (chain.module.rules.has(CHAIN_ID.RULE.VUE))
          {
            chain.module
              .rule(CHAIN_ID.RULE.VUE)
              .use(CHAIN_ID.USE.VUE)
              .tap((options) =>
              {
                return {
                  ...options,
                  compilerOptions:
                    {
                      ...options?.compilerOptions,
                      nodeTransforms: [createQuasarNodeTransform(opts.autoImportComponentCase, useTreeshaking)],
                    }
                };
              });
          }
        });
      }
    },
  };
}

export default function quasarPlugin(userOpts)
{
  const opts = parsePluginOptions(userOpts);

  const plugins = [getConfigPlugin(opts)];

  if (opts.sassVariables)
  {
    plugins.push(getScssTransformsPlugin(opts));
  }

  if (opts.runMode !== 'ssr-server')
  {
    plugins.push(getScriptTransformsPlugin(opts));
  }

  return plugins;
}

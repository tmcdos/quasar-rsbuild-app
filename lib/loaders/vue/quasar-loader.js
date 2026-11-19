import { resolve } from 'node:path';

import { normalizePath } from '../../utils/normalize-path.js';
import { createVariablesManager } from '../sass/scss-transform.js';
import {
  hasResidualQuasarImports,
  loadQuasarImportMap,
  mapQuasarImports
} from './js-transform.js';
import { createExtMatcher, parseRsbuildRequest } from './query.js';
import { setRsbuildConfig } from './rsbuild-config.js';
import { createQuasarNodeTransform } from './vue-ast-transform.js';
import { vueTransform } from './vue-transform.js';

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
        const vueCfg = config.plugins.find(entry => entry.name === 'rsbuild:vue');

        if (!vueCfg)
        {
          throw new Error('[Quasar] In your Vite config file, please add the Quasar plugin ** after ** the Vue one');
        }
      });
    }
  };
}

function getScssTransformsPlugin(opts)
{
  const sassVariables =
    typeof opts.sassVariables === 'string'
      ? normalizePath(opts.sassVariables)
      : opts.sassVariables;

  const manager = createVariablesManager(sassVariables);

  return {
    name: 'rsbuild:quasar:scss',
    pre: ['rsbuild:sass'], // important
    /**
     * @param {import('@rsbuild/core').RsbuildPluginAPI} api
     */
    setup(api)
    {
      api.modifyRsbuildConfig(config =>
      {
        manager.setCacheRoot(config.root);
      });
      api.modifyRspackConfig(config =>
      {
        config.module = config.module || {};
        config.module.rules = config.module.rules || [];
        // find the SASS rule from @rsbuild/plugin-sass
        const sassRule = config.module.rules.find(rule => rule.test && rule.test.test('test.scss'));
        if (sassRule && sassRule.oneOf)
        {
          const oneOfRules = sassRule.oneOf;
          const targetIndex = oneOfRules.findIndex(rule => rule.use && !rule.resourceQuery);
          if (targetIndex !== -1)
          {
            // add our loader so it runs before the SASS compilation
            oneOfRules[targetIndex].use.push({
              loader: resolve(import.meta.dirname, '../sass/scss-transform.js'),
              options:
                {
                  sassVariables,
                  manager,
                }
            });
          }
        }
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
                      nodeTransforms: [
                        ...(options?.compilerOptions?.nodeTransforms || []),
                        createQuasarNodeTransform(opts.autoImportComponentCase, useTreeshaking)
                      ],
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

  const plugins = [/*getConfigPlugin(opts)*/];
  /*
  if (opts.sassVariables)
  {
    plugins.push(getScssTransformsPlugin(opts));
  }
  */
  if (opts.runMode !== 'ssr-server')
  {
    plugins.push(getScriptTransformsPlugin(opts));
  }

  return plugins;
}

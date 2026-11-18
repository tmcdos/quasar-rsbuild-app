import quasarPkg from 'quasar/package.json' with { type: 'json' };

export function setRsbuildConfig(
  runMode,
  isServing,
  rsbuildCfg
)
{
  const defines = rsbuildCfg.source.define;
  defines.__QUASAR_VERSION__ = `'${quasarPkg.version}'`;
  defines.__QUASAR_SSR__ = false;
  defines.__QUASAR_SSR_SERVER__ = false;
  defines.__QUASAR_SSR_CLIENT__ = false;

  // Set this to the default value only if it's not already set.
  // quasar-rsbuild-app configures this by itself when it needs it.
  if (!('__QUASAR_SSR_PWA__' in defines))
  {
    defines.define.__QUASAR_SSR_PWA__ = false;
  }

  if (runMode === 'ssr-server')
  {
    Object.assign(defines, {
      __QUASAR_SSR__: true,
      __QUASAR_SSR_SERVER__: true
    });
  }
  else
  {
    // Alias "quasar" package to its single-file client build to reduce
    // the number of HTTP requests that the dev server has to answer
    if (isServing)
    {
      rsbuildCfg.resolve.alias['quasar'] = 'quasar/dist/quasar.client.js';
    }

    if (runMode === 'ssr-client')
    {
      Object.assign(defines, {
        __QUASAR_SSR__: true,
        __QUASAR_SSR_CLIENT__: true
      });
    }
  }
}

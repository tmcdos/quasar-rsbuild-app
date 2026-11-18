import serveStatic from 'serve-static';

import { entryPointMarkup } from '../../plugins/rsbuild.html.js';

/**
 * It is applied for dev only!
 */
export function quasarRsbuildPluginDevCordovaPlatformInject(quasarConf)
{
  const folder = quasarConf.ctx.appPaths.resolve.cordova(`platforms/${quasarConf.ctx.targetName}/platform_www`);

  return {
    name: 'quasar:cordova-platform-inject',
    setup(api)
    {
      api.modifyHTML(html => html.replace(
        entryPointMarkup,
        `<script src="cordova.js"></script>${entryPointMarkup}`
      ));
      api.onBeforeStartDevServer(({ server }) =>
      {
        server.middlewares.use('/', serveStatic(folder, { maxAge: 0 }));
      });
    },
  };
}

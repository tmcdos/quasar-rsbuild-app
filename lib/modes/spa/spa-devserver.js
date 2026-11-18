import { createRsbuild } from '@rsbuild/core';

import { AppDevserver } from '../../app-devserver.js';
import { updateHtmlVariables } from '../../plugins/rsbuild.html.js';
import { quasarSpaConfig } from './spa-config.js';

export class QuasarModeDevserver extends AppDevserver
{
  constructor(opts)
  {
    super(opts);

    this.registerRunSteps([
      {
        diff: 'htmlTemplate',
        fn: quasarConf =>
        {
          this.clientNeedsReload = true;
          updateHtmlVariables(quasarConf);
        }
      },

      {
        diff: 'rsbuild',
        fn: this.#runRsbuild.bind(this)
      },

      {
        diff: 'rsbuildUrl',
        fn: this.openBrowser.bind(this)
      }
    ]);
  }

  async #runRsbuild(quasarConf)
  {
    this.clientNeedsReload = false;

    const rsbuildConfig = await quasarSpaConfig.rsbuild(quasarConf);
    const rsbuild = await createRsbuild({
      config: rsbuildConfig,
    });

    const server = await rsbuild.createDevServer();

    await this.rebootClient(server);

    this.printBanner(quasarConf);
  }
}

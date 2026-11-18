import { createRsbuild } from '@rsbuild/core';
import { watch as chokidarWatch } from 'chokidar';

import { AppDevserver } from '../../app-devserver.js';
import { updateHtmlVariables } from '../../plugins/rsbuild.html.js';
import { log } from '../../utils/logger.js';
import { debounce } from '../../utils/rate-limit.js';
import { quasarPwaConfig } from './pwa-config.js';
import { buildPwaServiceWorker, injectPwaManifest } from './pwa-utils.js';

export class QuasarModeDevserver extends AppDevserver
{
  // also update ssr-devserver.js when changing here
  #pwaManifestWatcher = null;
  #pwaServiceWorkerWatcher = null;

  constructor(opts)
  {
    super(opts);

    this.registerRunSteps([
      {
        diff: 'pwaManifest',
        fn: this.#compilePwaManifest.bind(this)
      },

      {
        diff: 'pwaServiceWorker',
        fn: this.#compilePwaServiceWorker.bind(this)
      },

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

    const rsbuildConfig = await quasarPwaConfig.rsbuild(quasarConf);
    const rsbuild = await createRsbuild({
      config: rsbuildConfig,
    });

    const server = await rsbuild.createDevServer();

    await this.rebootClient(server);

    this.printBanner(quasarConf);
  }

  // also update ssr-devserver.js & ssg-devserver.js when changing here
  async #compilePwaManifest(quasarConf, diffName)
  {
    if (this.#pwaManifestWatcher !== null)
    {
      const watcher = this.#pwaManifestWatcher;
      this.#pwaManifestWatcher = null;
      await watcher.close();
    }

    async function inject()
    {
      await injectPwaManifest(
        quasarConf,
        quasarConf.ctx.appPaths.resolve.entry(`service-worker/${quasarConf.pwa.manifestFilename}`)
      );

      log(`Generated the PWA manifest file (${quasarConf.pwa.manifestFilename})`);
    }

    this.#pwaManifestWatcher = chokidarWatch(
      quasarConf.metaConf.pwaManifestFile,
      {
        ignoreInitial: true
      }
    ).on(
      'change',
      debounce(() =>
      {
        this.queue(diffName, async latestQuasarConf =>
        {
          await inject();
          updateHtmlVariables(latestQuasarConf);
          this.reloadClient();
        });
      }, 550)
    );

    await inject();
  }

  // also update ssr-devserver.js & ssg-devserver.js when changing here
  async #compilePwaServiceWorker(quasarConf, diffName)
  {
    if (this.#pwaServiceWorkerWatcher !== null)
    {
      const watcher = this.#pwaServiceWorkerWatcher;
      this.#pwaServiceWorkerWatcher = null;
      await watcher.close();
    }

    const workboxConfig = await quasarPwaConfig.workbox(quasarConf);

    if (quasarConf.pwa.workboxMode === 'InjectManifest')
    {
      const rolldownConfig = await quasarPwaConfig.customSw(quasarConf);
      await this.watchWithRolldown(
        'InjectManifest Custom SW',
        rolldownConfig,
        () =>
        {
          this.queue(diffName, latestQuasarConf =>
            buildPwaServiceWorker(latestQuasarConf, workboxConfig)
              .then(() => this.reloadClient())
          );
        }
      ).then(watcher =>
      {
        this.#pwaServiceWorkerWatcher = watcher;
      });
    }

    await buildPwaServiceWorker(quasarConf, workboxConfig);
  }
}

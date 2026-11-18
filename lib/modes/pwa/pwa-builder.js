import { join } from 'node:path';

import { AppBuilder } from '../../app-builder.js';
import { quasarPwaConfig } from './pwa-config.js';
import { buildPwaServiceWorker, injectPwaManifest } from './pwa-utils.js';

export class QuasarModeBuilder extends AppBuilder
{
  async build()
  {
    this.cleanArtifacts();

    await injectPwaManifest(
      this.quasarConf,
      join(this.quasarConf.build.distDir, this.quasarConf.pwa.manifestFilename)
    );

    await this.#buildUI();
    await this.#buildPWA();

    this.printSummary(this.quasarConf.build.distDir, true);
  }

  async #buildUI()
  {
    const rsbuildConfig = await quasarPwaConfig.rsbuild(this.quasarConf);
    await this.buildWithRsbuild('PWA UI', rsbuildConfig);
  }

  async #buildPWA()
  {
    // also update ssr-builder.js when changing here
    if (this.quasarConf.pwa.workboxMode === 'InjectManifest')
    {
      const rolldownConfig = await quasarPwaConfig.customSw(this.quasarConf);
      await this.buildWithRolldown('InjectManifest Custom SW', rolldownConfig);
    }

    // also update ssr-builder.js when changing here
    const workboxConfig = await quasarPwaConfig.workbox(this.quasarConf);
    await buildPwaServiceWorker(this.quasarConf, workboxConfig);
  }
}

import { AppBuilder } from '../../app-builder.js';
import { quasarSpaConfig } from './spa-config.js';

export class QuasarModeBuilder extends AppBuilder
{
  async build()
  {
    this.cleanArtifacts();

    const rsbuildConfig = await quasarSpaConfig.rsbuild(this.quasarConf);
    const stats = await this.buildWithRsbuild('SPA UI', rsbuildConfig);
    if (stats)
    {
      console.log(stats.toString({
        colors: true,
        preset: 'normal', // Options: 'normal', 'minimal', 'detailed', 'summary'
      }));
    }
  }
}

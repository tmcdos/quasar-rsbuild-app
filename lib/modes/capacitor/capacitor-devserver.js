import { createRsbuild } from '@rsbuild/core';

import { AppDevserver } from '../../app-devserver.js';
import { updateHtmlVariables } from '../../plugins/rsbuild.html.js';
import { fatal, log } from '../../utils/logger.js';
import { onShutdown } from '../../utils/on-shutdown.js';
import { openIDE } from '../../utils/open-ide.js';
import { spawn } from '../../utils/spawn.js';
import { quasarCapacitorConfig } from './capacitor-config.js';
import { CapacitorConfigFile } from './config-file.js';

export class QuasarModeDevserver extends AppDevserver
{
  #pid = 0;
  #target;
  #capacitorConfigFile = new CapacitorConfigFile();

  constructor(opts)
  {
    super(opts);

    this.#target = this.ctx.targetName;

    onShutdown(() =>
    {
      this.#stopCapacitor();
    });

    this.registerDiff('capacitor', quasarConf => [
      quasarConf.metaConf.APP_URL,
      quasarConf.capacitor
    ]);

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
        diff: 'capacitor',
        fn: this.#runCapacitor.bind(this)
      }
    ]);
  }

  async #runRsbuild(quasarConf)
  {
    this.clientNeedsReload = false;

    const rsbuildConfig = await quasarCapacitorConfig.rsbuild(quasarConf);
    const rsbuild = await createRsbuild({
      config: rsbuildConfig,
    });
    const server = await rsbuild.createDevServer();

    await this.rebootClient(server);
  }

  async #runCapacitor(quasarConf)
  {
    this.clientNeedsReload = false;
    this.#stopCapacitor();

    await this.#capacitorConfigFile.prepare(quasarConf, this.#target);

    const { appPaths, cacheProxy } = this.ctx;
    const { capBin } = await cacheProxy.getModule('capCli');

    await this.#runCapacitorCommand(
      quasarConf.capacitor.capacitorCliPreparationParams,
      appPaths.capacitorDir,
      capBin
    );

    await openIDE({
      mode: 'capacitor',
      bin: quasarConf.bin,
      target: this.#target,
      dev: true,
      appPaths
    });
  }

  #stopCapacitor()
  {
    if (this.#pid)
    {
      log('Shutting down Capacitor process...');
      process.kill(this.#pid);
      this.#cleanup();
    }
  }

  #runCapacitorCommand(args, cwd, capBin)
  {
    const { promise, resolve } = Promise.withResolvers();
    this.#pid = spawn(
      capBin,
      args,
      {
        cwd,
        env: this.#capacitorConfigFile.runtimeEnv
      },
      code =>
      {
        this.#cleanup();

        if (code)
        {
          fatal('Capacitor CLI has failed', 'FAIL');
        }

        resolve();
      }
    );

    return promise;
  }

  #cleanup()
  {
    this.#pid = 0;
  }
}

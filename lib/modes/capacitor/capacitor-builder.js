import { join } from 'node:path';

import fse from 'fs-extra';

import { AppBuilder } from '../../app-builder.js';
import { fatal, log, warn } from '../../utils/logger.js';
import { openIDE } from '../../utils/open-ide.js';
import { SIGNALS } from '../../utils/signals.js';
import { spawn, spawnSync } from '../../utils/spawn.js';
import { quasarCapacitorConfig } from './capacitor-config.js';
import { CapacitorConfigFile } from './config-file.js';

export class QuasarModeBuilder extends AppBuilder
{
  #capacitorConfigFile = new CapacitorConfigFile();
  #packagedDir;

  async build()
  {
    this.cleanArtifacts();
    this.#packagedDir = join(this.quasarConf.build.distDir, this.ctx.targetName);

    await this.#buildFiles();
    await this.#packageFiles();
  }

  async #buildFiles()
  {
    const rsbuildConfig = await quasarCapacitorConfig.rsbuild(this.quasarConf);
    const stats = await this.buildWithRsbuild('Capacitor UI', rsbuildConfig);
    if (stats)
    {
      console.log(stats.toString({
        colors: true,
        preset: 'normal', // Options: 'normal', 'minimal', 'detailed', 'summary'
      }));
    }
  }

  async #packageFiles()
  {
    const target = this.ctx.targetName;
    const { appPaths, cacheProxy } = this.ctx;

    await this.#capacitorConfigFile.prepare(this.quasarConf, target);

    const { capBin } = await cacheProxy.getModule('capCli');

    await this.#runCapacitorCommand(
      this.quasarConf.capacitor.capacitorCliPreparationParams,
      capBin
    );

    if (!this.argv['skip-pkg'])
    {
      if (this.argv.ide)
      {
        await openIDE({
          mode: 'capacitor',
          bin: this.quasarConf.bin,
          target,
          appPaths
        });

        return SIGNALS.BUILD_EXTERNAL_TOOL_SPAWNED;
      }

      await (target === 'ios' ? this.#buildIos() : this.#buildAndroid());
    }
  }

  #runCapacitorCommand(args, capBin)
  {
    const { promise, resolve } = Promise.withResolvers();
    spawn(
      capBin,
      args,
      {
        cwd: this.ctx.appPaths.capacitorDir,
        env: this.#capacitorConfigFile.runtimeEnv
      },
      code =>
      {
        if (code)
        {
          fatal('Capacitor CLI has failed', 'FAIL');
        }

        resolve();
      }
    );

    return promise;
  }

  async #buildIos()
  {
    const buildType = this.quasarConf.metaConf.debugging ? 'debug' : 'release';
    // the scheme (and workspace file) follow the Xcode project name,
    // which users may have renamed from the default "App"
    const scheme = this.quasarConf.capacitor.iosBuildScheme;
    const workspaceArgs = fse.existsSync(
      this.ctx.appPaths.resolve.capacitor(`ios/App/${scheme}.xcworkspace`)
    )
      ? ['-workspace', `${scheme}.xcworkspace`]
      : [];

    log('Building iOS app...');

    await spawnSync(
      'xcrun',
      [
        'xcodebuild',
        ...workspaceArgs,
        '-scheme',
        scheme,
        '-configuration',
        buildType,
        '-derivedDataPath',
        this.#packagedDir,
        ...this.argv._
      ],
      { cwd: this.ctx.appPaths.resolve.capacitor('ios/App') },
      () =>
      {
        console.log();
        console.log(' ⚠️  xcodebuild command failed!');
        console.log(' ⚠️  As an alternative, you can use the "--ide" param and build from the IDE.');
        console.log();

        // cleanup build folder
        fse.removeSync(this.#packagedDir);
      }
    );
  }

  async #buildAndroid()
  {
    const buildPath = this.ctx.appPaths.resolve.capacitor(
      'android/app/build/outputs'
    );

    // Remove old build output
    fse.removeSync(buildPath);

    log('Building Android app...');

    await spawnSync(
      `./gradlew${process.platform === 'win32' ? '.bat' : ''}`,
      [
        `assemble${this.quasarConf.metaConf.debugging ? 'Debug' : 'Release'}`,
        ...this.argv._
      ],
      { cwd: this.ctx.appPaths.resolve.capacitor('android') },
      () =>
      {
        warn();
        warn('Gradle build failed!');
        warn('As an alternative, you can use the "--ide" param and build from the IDE.');
        warn();
      }
    );

    fse.copySync(buildPath, this.#packagedDir);
  }
}

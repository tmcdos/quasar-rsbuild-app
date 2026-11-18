import { createRsbuild } from '@rsbuild/core';
import { rolldown, watch as rolldownWatch } from 'rolldown';

import { fatal, progress, warn } from './utils/logger.js';
import { removeBuildArtifacts } from './utils/remove-build-artifacts.js';

export class AppTool
{
  argv;
  ctx;

  constructor({ argv, ctx })
  {
    this.argv = argv;
    this.ctx = ctx;
  }

  buildWithRsbuild(threadName, rsbuildConfig)
  {
    const done = progress({
      tool: 'Rsbuild',
      waitAction: 'Compiling',
      doneAction: 'Compiled',
      target: threadName
    });

    return createRsbuild({
      config: rsbuildConfig,
    })
      .then(rsbuild => rsbuild.build())
      .then(result =>
      {
        const { stats } = result;
        if (stats)
        {
          // Check for compilation errors
          if (stats.hasErrors() === true)
          {
            const { printWebpackErrors } = require('./utils/print-webpack-issue/index.js');
            const summary = printWebpackErrors(threadName, stats);
            console.log();
            fatal(
              `for "${threadName}" with ${summary}. Please check the log above.`,
              'COMPILATION FAILED'
            );
          }

          console.log();

          // Check for compilation warnings
          if (stats.hasWarnings())
          {
            const { printWebpackWarnings } = require('./utils/print-webpack-issue/index.js');
            const summary = printWebpackWarnings(threadName, stats);
            warn(`Build succeeded, but with ${summary}. Check log above.\n`);
          }
          done();
          return stats;
        }
      })
      .catch(err =>
      {
        // Handles fatal structural errors (e.g., severe config misalignments)
        console.error(err.stack || err);

        if (err.details)
        {
          console.error(err.details);
        }
      });
  }

  watchWithRolldown(threadName, rolldownConfig, onRebuildSuccess)
  {
    const { promise, resolve } = Promise.withResolvers();
    const watcher = rolldownWatch({
      ...rolldownConfig,
      watch:
      {
        exclude: /node_modules/
      }
    });

    let isFirstBuild = true;
    let done;

    watcher.on('event', event =>
    {
      if (event.code === 'START')
      {
        done = progress({
          tool: 'Rolldown',
          waitAction: 'Compiling',
          doneAction: 'Compiled',
          target: threadName
        });
      }
      else if (event.code === 'BUNDLE_END')
      {
        event.result.close();
        done();

        if (isFirstBuild)
        {
          isFirstBuild = false;
          resolve(watcher);
        }
        else
        {
          onRebuildSuccess();
        }
      }
      else if (event.code === 'ERROR')
      {
        console.error(event.error);
        event.result.close();
      }
    });

    return promise;
  }

  async buildWithRolldown(threadName, rolldownConfig)
  {
    const done = progress({
      tool: 'Rolldown',
      waitAction: 'Compiling',
      doneAction: 'Compiled',
      target: threadName
    });

    const bundle = await rolldown(rolldownConfig);
    await bundle.write(rolldownConfig.output);
    await bundle.close();

    done();
  }

  cleanArtifacts(
    dir = this.quasarConf.build.distDir,
    allowOutsideProject = this.quasarConf.build.allowOutsideProjectDistDir
  )
  {
    try
    {
      removeBuildArtifacts({
        targetDir: dir,
        projectDir: this.ctx.appPaths.appDir,
        allowOutsideProject
      });
    }
    catch (err)
    {
      fatal(err.message, 'FAIL');
    }
  }
}

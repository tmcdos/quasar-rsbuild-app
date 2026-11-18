import { fatal } from './logger.js';

export function ensureArgv(argv, cmd)
{
  if (argv.mode)
  {
    if (argv.mode === 'ios')
    {
      argv.m = argv.mode = 'capacitor';
      argv.T = argv.target = 'ios';

      console.log();
      console.log(' Converting to long form: -m capacitor -T ios');
    }
    else if (argv.mode === 'android')
    {
      argv.m = argv.mode = 'capacitor';
      argv.T = argv.target = 'android';

      console.log();
      console.log(' Converting to long form: -m capacitor -T android');
    }
  }

  if (
    ![
      'bex',
      'capacitor',
      'cordova',
      'electron',
      'pwa',
      'spa',
      'ssg',
      'ssr'
    ].includes(argv.mode)
  )
  {
    fatal(`Unknown mode "${argv.mode}"`);
  }

  if (cmd === 'inspect')
  {
    return;
  }

  if (argv.mode === 'capacitor')
  {
    const targets = ['android', 'ios'];
    if (!argv.target)
    {
      fatal(`Please also specify a target (-T <${targets.join('|')}>)`);
    }
    if (!targets.includes(argv.target))
    {
      fatal(`Unknown target "${argv.target}" for Capacitor`);
    }
  }

  if (argv.mode === 'cordova')
  {
    const targets = [
      'android',
      'ios',
      'electron',
      'blackberry10',
      'browser',
      'osx',
      'ubuntu',
      'webos',
      'windows'
    ];
    if (!argv.target)
    {
      fatal(`Please also specify a target (-T <${targets.join('|')}>)`);
    }
    if (!targets.includes(argv.target))
    {
      fatal(`Unknown target "${argv.target}" for Cordova`);
    }
  }

  if (argv.mode === 'bex')
  {
    const targets = ['chrome', 'firefox'];
    if (!argv.target)
    {
      argv.target = 'chrome';
    }
    else if (!targets.includes(argv.target))
    {
      fatal(`Unknown target "${argv.target}" for BEX`);
    }
  }

  if (
    cmd === 'build' &&
    argv.mode === 'electron' &&
    !['builder', 'packager', void 0].includes(argv.bundler)
  )
  {
    fatal(`Unknown bundler "${argv.bundler}" for Electron`);
  }
}

export function ensureElectronArgv(bundlerName, ctx)
{
  if (!['builder', 'packager'].includes(bundlerName))
  {
    fatal(`Unknown bundler "${bundlerName}" for Electron`);
  }

  if (bundlerName === 'packager')
  {
    if (
      !['all', 'darwin', 'linux', 'mas', void 0, 'win32'].includes(ctx.targetName)
    )
    {
      fatal(`Unknown target "${ctx.targetName}" for @electron/packager`);
    }
    if (
      !['all', 'arm64', 'armv7l', 'ia32', 'mips64el', void 0, 'x64'].includes(ctx.archName)
    )
    {
      fatal(`Unknown architecture "${ctx.archName}" for @electron/packager`);
    }
  }
  else
  {
    // electron-builder bundler
    if (
      !['all', 'darwin', 'linux', 'mac', void 0, 'win', 'win32'].includes(ctx.targetName)
    )
    {
      fatal(`Unknown target "${ctx.targetName}" for electron-builder`);
    }
    if (
      !['all', 'arm64', 'armv7l', 'ia32', void 0, 'x64'].includes(ctx.archName)
    )
    {
      fatal(`Unknown architecture "${ctx.archName}" for electron-builder`);
    }
  }
}

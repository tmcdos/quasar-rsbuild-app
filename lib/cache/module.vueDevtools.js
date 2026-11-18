import { getPackage } from '../utils/get-package.js';

export async function createInstance({ appPaths })
{
  const { default: vitePluginVueDevtools } = await getPackage(
    '@vue-devtools-rstack/rsbuild',
    appPaths.appDir
  );

  return vitePluginVueDevtools;
}

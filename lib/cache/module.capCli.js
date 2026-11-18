import { getPackageMajorVersion } from '../utils/get-package-major-version.js';
import { getPackagePath } from '../utils/get-package-path.js';

export function createInstance({ appPaths: { capacitorDir } })
{
  return {
    capBin: getPackagePath('@capacitor/cli/bin/capacitor', capacitorDir),
    capVersion: getPackageMajorVersion('@capacitor/cli', capacitorDir)
  };
}

import babelError from '../formatters/babelError.js';

export default function transform(error)
{
  return error.__formatter === void 0 && error.name === 'ModuleBuildError'
    ? {
        ...error,
        __severity: 1000,
        __formatter: babelError
      }
    : error;
}

/**
 * Initially forked from friendly-errors-webpack-plugin 2.0.0-beta.2
 */

import extractError from './extractWebpackError.js';
import transformersList from './transformers/index.js';

export default function transformErrors(errors)
{
  const transform = (error, transformer) => transformer(error);
  const applyTransformations = error => transformersList.reduce(transform, error);

  return errors.map(extractError).map(applyTransformations);
}

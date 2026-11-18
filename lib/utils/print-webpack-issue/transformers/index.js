import babelSyntax from './babelSyntax.js';
import defaultTransformer from './defaultTransformer.js';
import esLintError from './esLintError.js';
import moduleNotFound from './moduleNotFound.js';
import stringError from './stringError.js';

export default [
  babelSyntax,
  moduleNotFound,
  esLintError,
  stringError,
  defaultTransformer
];

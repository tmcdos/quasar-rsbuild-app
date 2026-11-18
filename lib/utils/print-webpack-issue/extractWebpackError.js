import ErrorStackParser from 'error-stack-parser';

/*
 MIT License http://www.opensource.org/licenses/mit-license.php
 Author Tobias Koppers @sokra
 */
import { contextify } from './identifier';

/** @typedef {import("./identifier").AssociatedObjectForCache} AssociatedObjectForCache */

/**
 * Shortens absolute or verbose request strings so diagnostics and stats output
 * can be rendered relative to a chosen base directory.
 */
class RequestShortener
{
  /**
   * Binds a context-aware shortening function to the provided directory and
   * optional cache owner.
   * @param {string} dir the directory
   * @param {AssociatedObjectForCache=} associatedObjectForCache an object to which the cache will be attached
   */
  constructor(dir, associatedObjectForCache)
  {
    this.contextify = contextify.bindContextCache(
      dir,
      associatedObjectForCache
    );
  }

  /**
   * Returns a request string rewritten relative to the configured directory
   * when one is provided.
   * @param {string | undefined | null} request the request to shorten
   * @returns {string | undefined | null} the shortened request
   */
  shorten(request)
  {
    if (!request)
    {
      return request;
    }
    return this.contextify(request);
  }
}

const requestShortener = new RequestShortener(process.cwd());

/*
 This logic is mostly duplicated from webpack/lib/Stats.js#toJson()
 See: https://github.com/webpack/webpack/blob/2f618e733aab4755deb42e9d8e859609005607c0/lib/Stats.js#L89
*/

function getOriginalErrorStack(e)
{
  while (e.error != null)
  {
    e = e.error;
  }

  return e.stack ? ErrorStackParser.parse(e) : [];
}

function getFile(e)
{
  if (e.file)
  {
    return e.file;
  }
  else if
  (
    e.module &&
    e.module.readableIdentifier &&
    typeof e.module.readableIdentifier === 'function'
  )
  {
    return e.module.readableIdentifier(requestShortener);
  }
}

function getOrigin(e)
{
  let origin = '';

  if (e.dependencies && e.origin)
  {
    origin += '\n @ ' + e.origin.readableIdentifier(requestShortener);

    e.dependencies.forEach(dep =>
    {
      if (!dep.loc)
      {
        return;
      }
      if (typeof dep.loc === 'string')
      {
        return;
      }
      if (!dep.loc.start)
      {
        return;
      }
      if (!dep.loc.end)
      {
        return;
      }

      origin +=
        ' ' +
        dep.loc.start.line +
        ':' +
        dep.loc.start.column +
        '-' +
        (dep.loc.start.line !== dep.loc.end.line
          ? dep.loc.end.line + ':'
          : '') +
        dep.loc.end.column;
    });

    let current = e.origin;
    while (current.issuer && typeof current.issuer.readableIdentifier === 'function')
    {
      current = current.issuer;
      origin += '\n @ ' + current.readableIdentifier(requestShortener);
    }
  }

  return origin;
}

export default function extractError(e)
{
  return {
    message: e.message,
    file: getFile(e),
    origin: getOrigin(e),
    name: e.name,
    severity: 0,
    webpackError: e,
    originalStack: getOriginalErrorStack(e)
  };
}

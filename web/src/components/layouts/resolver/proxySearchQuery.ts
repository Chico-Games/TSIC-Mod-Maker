import type { ProxySearchTreeQuery } from '../types';
import { parseSearchQuery } from '../types';

/** Returns true if `candidate` is `parent` or a dotted descendant. */
function isOrChild(candidate: string, parent: string): boolean {
  return candidate === parent || candidate.startsWith(parent + '.');
}

/** Does `targetTags` contain `query` (or one of its descendants when `inclParents`)? */
function targetHasTag(targetTags: string[], query: string, inclParents: boolean): boolean {
  if (!inclParents) return targetTags.includes(query);
  return targetTags.some((t) => isOrChild(t, query));
}

/** Port of FProxySearchTreeQuery::QueryTags. */
export function queryMatches(q: ProxySearchTreeQuery, targetTags: string[]): boolean {
  const mode = parseSearchQuery(q.value.search_query.value);
  const queryTags = q.value.tags.value;
  const bNot = q.value.b_not.value;

  let raw: boolean;
  switch (mode) {
    case 'None':
      raw = true;
      break;
    case 'HasAnyExact':
      raw = queryTags.some((qt) => targetHasTag(targetTags, qt, false));
      break;
    case 'HasAnyInclParents':
      raw = queryTags.some((qt) => targetHasTag(targetTags, qt, true));
      break;
    case 'HasAllExact':
      raw = queryTags.every((qt) => targetHasTag(targetTags, qt, false));
      break;
    case 'HasAllInclParents':
      raw = queryTags.every((qt) => targetHasTag(targetTags, qt, true));
      break;
    default:
      raw = false;
  }
  return bNot ? !raw : raw;
}

/** Run a series of queries — returns true only when ALL queries match. */
export function allQueriesMatch(queries: ProxySearchTreeQuery[], targetTags: string[]): boolean {
  return queries.every((q) => queryMatches(q, targetTags));
}

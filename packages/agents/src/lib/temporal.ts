/** Single Temporal implementation boundary, independent of application code.
 * @module
 */

/** Use the ISO/Gregorian ponyfill without changing globals until the Workers runtime supports
 * native Temporal. Switch the implementation here so callers keep the same import and API.
 */
export { Temporal } from 'temporal-polyfill-lite'

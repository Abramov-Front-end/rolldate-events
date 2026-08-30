/**
 * Feature flags — `__PRO__` replaced at build time.
 */

export type FeatureName = 'recurring' | 'dragDrop' | 'resourceTimeline'

const PRO_FEATURES: FeatureName[] = ['recurring', 'dragDrop', 'resourceTimeline']

/** True only in the Pro bundle */
export function isProBuild(): boolean {
  return typeof __PRO__ !== 'undefined' && __PRO__ === true
}

export function isProFeature(name: FeatureName): boolean {
  return isProBuild() && PRO_FEATURES.includes(name)
}

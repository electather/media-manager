import { consola } from 'consola'
import type { PreferenceProfile, FeedbackSignals } from './types'
import type { MediaItem } from '../media/types'

/** Manages per-user preference profiles and re-ranks media results. */
export class PreferenceEngine {
  async updateFromFeedback(
    _userId: string,
    _signals: FeedbackSignals,
    _weight: number,
  ): Promise<void> {
    consola.debug('PreferenceEngine.updateFromFeedback', { _userId })
    // TODO: implement score decay + update logic.
  }

  async rerank(_userId: string, items: MediaItem[]): Promise<MediaItem[]> {
    consola.debug('PreferenceEngine.rerank', { _userId, count: items.length })
    // TODO: implement dot-product scoring against preference profile.
    return items
  }

  async getProfile(_userId: string): Promise<PreferenceProfile | null> {
    consola.debug('PreferenceEngine.getProfile', { _userId })
    // TODO: implement DB lookup.
    return null
  }
}

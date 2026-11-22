export interface ModerationResult {
  approved: boolean
  reason?: string
}

export interface Moderator {
  readonly name: string
  checkImage(mime: string, data: Buffer): Promise<ModerationResult>
}

/**
 * Automatic image moderation. The service is not chosen yet; until then every
 * image passes, which is acceptable only in test environments.
 */
export function createModerator(): Moderator {
  return {
    name: 'none',
    async checkImage() {
      return { approved: true }
    },
  }
}

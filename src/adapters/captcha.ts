export interface CaptchaVerifier {
  verify(token: string | undefined, remoteIp: string): Promise<boolean>
}

/**
 * Captcha check. The provider is not chosen yet; until CAPTCHA_SECRET is set
 * every request passes, which is only acceptable for local development.
 */
export function createCaptcha(secret: string, log: { warn: (msg: string) => void }): CaptchaVerifier {
  if (!secret) {
    log.warn('CAPTCHA_SECRET is not set: captcha checks are skipped')
    return { verify: async () => true }
  }
  return {
    async verify() {
      // Wire the chosen provider here (e.g. Cloudflare Turnstile or hCaptcha siteverify).
      throw new Error('Captcha provider is not implemented yet')
    },
  }
}

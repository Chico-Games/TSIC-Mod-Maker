// Friendly messages for the mod.io error_refs we expect to encounter.
// Reference: https://docs.mod.io/restapi/docs/error-codes

export const MODIO_ERROR_MESSAGES: Record<number, string> = {
  11000: 'Your mod.io session has expired. Please sign in again.',
  11002: 'OAuth token is invalid.',
  11004: 'OAuth token has been revoked.',
  11005: 'Missing OAuth token — sign in to continue.',
  11070: 'Your account is missing required details. Visit mod.io to complete setup.',
  11074: 'You need to accept mod.io terms of service first.',
  13009: 'Some fields didn’t pass validation.',
  14000: 'Endpoint not found.',
  15006: 'You don’t have permission to upload to this mod.',
  15010: 'Modfile not found.',
  15012: 'Your upload privileges are currently restricted on mod.io.',
  15022: 'Mod not found on mod.io.',
  15023: 'This mod has been deleted on mod.io.',
  15024: 'You don’t have permission to view this resource.',
  29002: 'This multipart upload identifier has already been used. Start a fresh upload.',
  29009: 'Multipart part out of range.',
  29013: 'Multipart parts (other than the last) must be exactly 50 MiB.',
  29015: 'Duplicate multipart part range.',
  29026: 'Final multipart part missing or wrong size.',
};

export class ModioError extends Error {
  constructor(
    public readonly http: number,
    public readonly errorRef: number | undefined,
    /** Server-provided message verbatim. */
    public readonly serverMessage: string,
    public readonly fieldErrors?: Record<string, string>,
    public readonly requestId?: string,
  ) {
    super(serverMessage);
    this.name = 'ModioError';
  }

  /** Human-friendly message: prefers the static catalogue if the ref is known,
   *  otherwise falls back to the server message. */
  get friendly(): string {
    if (this.errorRef != null && MODIO_ERROR_MESSAGES[this.errorRef]) {
      return MODIO_ERROR_MESSAGES[this.errorRef];
    }
    return this.serverMessage || `mod.io error (HTTP ${this.http})`;
  }

  /** True when the token should be cleared (signed-out state). */
  get isAuthFailure(): boolean {
    if (this.http === 401) return true;
    if (this.errorRef === 11000 || this.errorRef === 11002 || this.errorRef === 11004 || this.errorRef === 11005) return true;
    return false;
  }
}

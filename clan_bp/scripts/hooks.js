// @ts-check
/**
 * A small event bus that keeps the domain modules from importing the ones that
 * react to them.
 *
 * `clans.js` and `staff.js` change a player's identity — their clan, their
 * role, their staff rank. `display.js` renders that identity and already
 * imports both, so instead of being imported back it subscribes here at
 * start-up and the domain modules announce.
 *
 * The same shape carries the other cross-domain facts: a disbanded clan, a clan
 * that has fallen below strength, and a settings write.
 */

/** @type {Array<(playerId: string) => void>} */
const identityListeners = [];

/** @type {Array<(clanId: string) => void>} */
const disbandListeners = [];

/**
 * Registers a listener called when a clan is disbanded.
 *
 * `wars.js` and `requests.js` both hold state that refers to a clan and must
 * not outlive it, and both already import `clans.js` — so they listen here
 * rather than `clans.js` importing them back.
 *
 * @param {(clanId: string) => void} listener
 */
export function onClanDisbanded(listener) {
  disbandListeners.push(listener);
}

/**
 * Announces that a clan has been disbanded.
 *
 * @param {string} clanId
 */
export function clanDisbanded(clanId) {
  for (const listener of disbandListeners) {
    try {
      listener(clanId);
    } catch (err) {
      console.warn(`[sigil] disband listener failed for ${clanId}: ${err}`);
    }
  }
}

/** @type {Array<(clanId: string) => void>} */
const understrengthListeners = [];

/**
 * Registers a listener called when a full clan drops below the membership a
 * promotion needs.
 *
 * `clans.js` notices it, because it owns the roster; `requests.js` acts on it,
 * because it owns the review queue. Neither should import the other, so the
 * fact travels through here like every other cross-domain signal.
 *
 * @param {(clanId: string) => void} listener
 */
export function onClanUnderstrength(listener) {
  understrengthListeners.push(listener);
}

/**
 * Announces that a clan has fallen below strength.
 *
 * @param {string} clanId
 */
export function clanUnderstrength(clanId) {
  for (const listener of understrengthListeners) {
    try {
      listener(clanId);
    } catch (err) {
      console.warn(`[sigil] understrength listener failed for ${clanId}: ${err}`);
    }
  }
}

/** @type {Array<(clanIdA: string, clanIdB: string) => string | undefined>} */
const declarationVetoes = [];

/**
 * Registers a listener that can refuse a war declaration, returning the reason
 * to show the player or `undefined` to allow it.
 *
 * `alliances.js` uses it to stop two allied clans declaring on each other. The
 * alliance module already imports `wars.js`, to refuse a proposal between clans
 * that are fighting, so the check in the other direction arrives here instead of
 * closing the loop.
 *
 * A veto only applies while the module registering it has been loaded.
 *
 * @param {(clanIdA: string, clanIdB: string) => string | undefined} listener
 */
export function onWarDeclarationVeto(listener) {
  declarationVetoes.push(listener);
}

/**
 * Asks every veto whether these two clans may go to war.
 *
 * @param {string} clanIdA
 * @param {string} clanIdB
 * @returns {string | undefined} the first refusal, if any
 */
export function warDeclarationVeto(clanIdA, clanIdB) {
  for (const listener of declarationVetoes) {
    try {
      const refusal = listener(clanIdA, clanIdB);
      if (refusal) return refusal;
    } catch (err) {
      console.warn(`[sigil] declaration veto failed: ${err}`);
    }
  }
  return undefined;
}

/** @type {Array<() => void>} */
const settingsListeners = [];

/**
 * Registers a listener called whenever the stored settings are written.
 *
 * `requests.js` needs it because the promotion threshold is a setting: raising
 * it can put clans below strength that were fine a moment ago, and lowering it
 * can clear reviews that are no longer warranted. `settings.js` must not import
 * the queue to say so, so the fact travels through here.
 *
 * @param {() => void} listener
 */
export function onSettingsChanged(listener) {
  settingsListeners.push(listener);
}

/**
 * Announces that the settings were written.
 */
export function settingsChanged() {
  for (const listener of settingsListeners) {
    try {
      listener();
    } catch (err) {
      console.warn(`[sigil] settings listener failed: ${err}`);
    }
  }
}

/**
 * Registers a listener called whenever a player's displayed identity changes.
 *
 * @param {(playerId: string) => void} listener
 */
export function onIdentityChanged(listener) {
  identityListeners.push(listener);
}

/**
 * Announces that a player's displayed identity changed. Listener failures are
 * contained: a broken renderer must not roll back a completed clan mutation.
 *
 * @param {string} playerId
 */
export function identityChanged(playerId) {
  for (const listener of identityListeners) {
    try {
      listener(playerId);
    } catch (err) {
      console.warn(`[sigil] identity listener failed for ${playerId}: ${err}`);
    }
  }
}

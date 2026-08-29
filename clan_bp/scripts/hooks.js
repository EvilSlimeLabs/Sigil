// @ts-check
/**
 * A one-signal event bus, used to break what would otherwise be an import
 * cycle.
 *
 * `clans.js` and `staff.js` change a player's identity (their clan, their role,
 * their staff rank). `display.js` renders that identity, and already imports
 * both of them. Rather than have the domain modules import the renderer back,
 * they announce the change here and `display.js` subscribes at start-up.
 *
 * The alternative — making every command and form remember to refresh the
 * display after each mutation — is the kind of thing that works until someone
 * adds the twelfth code path.
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

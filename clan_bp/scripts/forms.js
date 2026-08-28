// @ts-check
/**
 * The form layer: showing a form reliably, and reading a modal form's answers
 * back by name.
 *
 * ── Why modal answers are resolved rather than destructured ────────────────
 *
 * `ModalFormResponse.formValues` is documented only as "an ordered set of
 * values based on the order of controls", and it is genuinely unclear whether
 * a `label`, `header` or `divider` counts as a control and occupies a slot.
 * The value type includes `undefined`, which hints that they do.
 *
 * Rather than pick an answer and encode it — a wrong guess would silently
 * write every settings toggle to the wrong switch — the builder records a key
 * per element and works out which convention is in force from the response
 * length:
 *
 *   - `formValues.length === elements` -> non-inputs occupy slots; map by index
 *   - `formValues.length === inputs`   -> they do not; map to inputs in order
 *
 * The two can only agree when a form has no non-inputs, where the mapping is
 * identical anyway. So this is correct under either behaviour, and stays
 * correct if the engine's behaviour ever changes.
 *
 * Reading by key also removes the positional fragility that made adding a
 * control to a form a chance to shift every value after it.
 */

import { system } from '@minecraft/server';
import { ActionFormData, ModalFormData, FormCancelationReason } from '@minecraft/server-ui';

/** How long to keep retrying a form while the player has a screen open. */
const BUSY_RETRY_TICKS = 10;
const BUSY_MAX_ATTEMPTS = 20;

/**
 * Waits a number of ticks.
 *
 * @param {number} ticks
 * @returns {Promise<void>}
 */
function delay(ticks) {
  return new Promise((resolve) => system.runTimeout(() => resolve(), ticks));
}

/**
 * Whether a response failed only because the player had another screen open.
 *
 * A form opened on the same tick a player closes chat or another form comes
 * back cancelled with `UserBusy`. Retrying briefly is the difference between a
 * menu that always opens and one that silently does nothing every few uses.
 *
 * @param {import('@minecraft/server-ui').FormResponse} response
 * @returns {boolean}
 */
function isBusy(response) {
  return response.canceled && response.cancelationReason === FormCancelationReason.UserBusy;
}

/**
 * Shows an action form, retrying while the player is busy.
 *
 * @param {ActionFormData} form
 * @param {import('@minecraft/server').Player} player
 * @returns {Promise<import('@minecraft/server-ui').ActionFormResponse>}
 */
export async function showAction(form, player) {
  let response = await form.show(player);
  for (let attempt = 0; attempt < BUSY_MAX_ATTEMPTS && isBusy(response); attempt += 1) {
    await delay(BUSY_RETRY_TICKS);
    response = await form.show(player);
  }
  return response;
}

/**
 * A modal form's answers, read by the key each input was given.
 *
 * @typedef {object} ModalResult
 * @property {boolean} canceled
 * @property {(key: string, fallback?: boolean) => boolean} bool
 * @property {(key: string, fallback?: number) => number} num
 * @property {(key: string, fallback?: string) => string} str
 */

/**
 * Maps a response onto the keys the form was built with.
 *
 * @param {(string | null)[]} slots one entry per element; null for non-inputs
 * @param {(boolean | number | string | undefined)[]} formValues
 * @returns {Map<string, boolean | number | string | undefined>}
 */
function resolveValues(slots, formValues) {
  /** @type {Map<string, boolean | number | string | undefined>} */
  const values = new Map();
  const inputs = slots.filter(/** @returns {k is string} */ (k) => k !== null);

  if (formValues.length === slots.length) {
    // Non-input elements each took a slot.
    slots.forEach((key, index) => {
      if (key !== null) values.set(key, formValues[index]);
    });
    return values;
  }

  if (formValues.length !== inputs.length) {
    // Neither convention fits. Inputs-in-order is the likelier of the two and
    // degrades to sensible defaults; say so rather than fail silently.
    console.warn(
      `[sigil] unexpected form response: ${formValues.length} values for ` +
        `${inputs.length} inputs across ${slots.length} elements`,
    );
  }
  inputs.forEach((key, index) => values.set(key, formValues[index]));
  return values;
}

/**
 * Builds a modal form whose answers are read by name.
 *
 * Every input takes a `key` as its first argument; `header`, `label` and
 * `divider` take none, because they produce no answer to read.
 *
 * @param {string} title
 */
export function modal(title) {
  const form = new ModalFormData().title(title);
  /** @type {(string | null)[]} */
  const slots = [];

  const api = {
    /**
     * @param {string} text
     */
    header(text) {
      form.header(text);
      slots.push(null);
      return api;
    },
    /**
     * @param {string} text
     */
    label(text) {
      form.label(text);
      slots.push(null);
      return api;
    },
    divider() {
      form.divider();
      slots.push(null);
      return api;
    },
    /**
     * @param {string} key
     * @param {string} label
     * @param {import('@minecraft/server-ui').ModalFormDataToggleOptions} [options]
     */
    toggle(key, label, options) {
      form.toggle(label, options);
      slots.push(key);
      return api;
    },
    /**
     * @param {string} key
     * @param {string} label
     * @param {number} min
     * @param {number} max
     * @param {import('@minecraft/server-ui').ModalFormDataSliderOptions} [options]
     */
    slider(key, label, min, max, options) {
      form.slider(label, min, max, options);
      slots.push(key);
      return api;
    },
    /**
     * @param {string} key
     * @param {string} label
     * @param {string[]} items
     * @param {import('@minecraft/server-ui').ModalFormDataDropdownOptions} [options]
     */
    dropdown(key, label, items, options) {
      form.dropdown(label, items, options);
      slots.push(key);
      return api;
    },
    /**
     * @param {string} key
     * @param {string} label
     * @param {string} placeholder
     * @param {import('@minecraft/server-ui').ModalFormDataTextFieldOptions} [options]
     */
    textField(key, label, placeholder, options) {
      form.textField(label, placeholder, options);
      slots.push(key);
      return api;
    },
    /**
     * @param {string} text
     */
    submitButton(text) {
      form.submitButton(text);
      return api;
    },
    /**
     * @param {import('@minecraft/server').Player} player
     * @returns {Promise<ModalResult>}
     */
    async show(player) {
      let response = await form.show(player);
      for (let attempt = 0; attempt < BUSY_MAX_ATTEMPTS && isBusy(response); attempt += 1) {
        await delay(BUSY_RETRY_TICKS);
        response = await form.show(player);
      }

      if (response.canceled || !response.formValues) {
        return {
          canceled: true,
          bool: (_key, fallback = false) => fallback,
          num: (_key, fallback = 0) => fallback,
          str: (_key, fallback = '') => fallback,
        };
      }

      const values = resolveValues(slots, response.formValues);
      return {
        canceled: false,
        bool: (key, fallback = false) => {
          const value = values.get(key);
          return value === undefined ? fallback : Boolean(value);
        },
        num: (key, fallback = 0) => {
          const value = Number(values.get(key));
          return Number.isFinite(value) ? value : fallback;
        },
        str: (key, fallback = '') => {
          const value = values.get(key);
          return value === undefined ? fallback : String(value);
        },
      };
    },
  };

  return api;
}

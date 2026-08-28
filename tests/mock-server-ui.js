/**
 * A stand-in for `@minecraft/server-ui` that answers forms from a script.
 *
 * A test queues the answers it wants — a button index for an action form, a
 * map of values for a modal — and each `show()` takes the next one. That makes
 * the menu layer testable at all: which screens a given role can reach, which
 * buttons they are offered, and what a flow does with the answer.
 *
 * An empty queue means "the player closed it", which is also how a test asserts
 * that a screen was never reached: the flow simply cancels.
 */

export const FormCancelationReason = {
  UserBusy: 'UserBusy',
  UserClosed: 'UserClosed',
};

/** Queued answers, oldest first. */
const answers = [];

/**
 * Which convention this mock follows for non-input elements.
 *
 * The real engine is ambiguous about whether a label, header or divider takes
 * a slot in `formValues`, so the mock can be switched to either and the
 * resolver must cope with both.
 */
let slotMode = "all-slots";

/** @param {"all-slots" | "inputs-only"} mode */
export function __setSlotMode(mode) {
  slotMode = mode;
}

/** Every form shown since the last reset, for assertions. */
const shown = [];

/**
 * Queues one answer. For an action form pass a button index or its label text;
 * for a modal pass an object keyed the way the form was built.
 *
 * @param {number | string | Record<string, unknown>} answer
 */
export function __answer(answer) {
  answers.push(answer);
}

/** Queues several answers in order. */
export function __answers(...list) {
  for (const answer of list) answers.push(answer);
}

/** Everything shown, in order: `{ kind, title, body, buttons, inputs }`. */
export function __shown() {
  return shown.map((entry) => ({ ...entry }));
}

/** The most recently shown form. */
export function __lastShown() {
  return shown.length === 0 ? undefined : { ...shown[shown.length - 1] };
}

export function __resetForms() {
  answers.length = 0;
  shown.length = 0;
}

/** Strips formatting codes so assertions read as plain text. */
function plain(text) {
  return String(text).replace(/§./g, '');
}

export class ActionFormData {
  constructor() {
    this._title = '';
    this._body = '';
    this._buttons = [];
  }
  title(text) {
    this._title = String(text);
    return this;
  }
  body(text) {
    this._body = String(text);
    return this;
  }
  button(text) {
    this._buttons.push(String(text));
    return this;
  }
  header(text) {
    this._body += `\n${String(text)}`;
    return this;
  }
  label(text) {
    this._body += `\n${String(text)}`;
    return this;
  }
  divider() {
    return this;
  }

  async show() {
    const entry = {
      kind: 'action',
      title: plain(this._title),
      body: plain(this._body),
      buttons: this._buttons.map(plain),
    };
    shown.push(entry);

    if (answers.length === 0) {
      return { canceled: true, cancelationReason: FormCancelationReason.UserClosed };
    }

    const answer = answers.shift();
    // A label is friendlier than an index in a test, and survives a button
    // being inserted above it.
    const index =
      typeof answer === 'string'
        ? entry.buttons.findIndex((b) => b.includes(answer))
        : Number(answer);

    if (index < 0 || index >= entry.buttons.length) {
      throw new Error(
        `no button matching ${JSON.stringify(answer)} on "${entry.title}"; ` +
          `had: ${entry.buttons.map((b) => b.split('\n')[0]).join(' | ')}`,
      );
    }
    return { canceled: false, selection: index };
  }
}

export class ModalFormData {
  constructor() {
    this._title = '';
    // One slot per element, mirroring the real form: `null` for non-inputs.
    this._slots = [];
  }
  title(text) {
    this._title = String(text);
    return this;
  }
  header() {
    this._slots.push(null);
    return this;
  }
  label() {
    this._slots.push(null);
    return this;
  }
  divider() {
    this._slots.push(null);
    return this;
  }
  toggle(label, options) {
    this._slots.push({ kind: 'toggle', label: plain(label), value: options?.defaultValue ?? false });
    return this;
  }
  slider(label, min, max, options) {
    this._slots.push({ kind: 'slider', label: plain(label), value: options?.defaultValue ?? min });
    return this;
  }
  dropdown(label, items, options) {
    this._slots.push({
      kind: 'dropdown',
      label: plain(label),
      items: items.map(plain),
      value: options?.defaultValueIndex ?? 0,
    });
    return this;
  }
  textField(label, placeholder, options) {
    this._slots.push({
      kind: 'textField',
      label: plain(label),
      value: options?.defaultValue ?? '',
    });
    return this;
  }
  submitButton() {
    return this;
  }

  async show() {
    const inputs = this._slots.filter((slot) => slot !== null);
    shown.push({
      kind: 'modal',
      title: plain(this._title),
      inputs: inputs.map((slot) => ({ kind: slot.kind, label: slot.label })),
    });

    if (answers.length === 0) {
      return { canceled: true, cancelationReason: FormCancelationReason.UserClosed };
    }

    const answer = answers.shift();
    if (typeof answer !== 'object' || answer === null) {
      throw new Error(`modal "${plain(this._title)}" needs an object answer, got ${answer}`);
    }

    // Answers arrive keyed the way the production form was built, and the
    // builder maps them back positionally — so the test supplies them in the
    // order the inputs were added, by the same keys.
    const keys = Object.keys(answer);
    const values = inputs.map((slot, index) => {
      const key = keys[index];
      return key === undefined ? slot.value : answer[key];
    });

    const formValues =
      slotMode === "all-slots"
        ? this._slots.map((slot) => (slot === null ? undefined : values[inputs.indexOf(slot)]))
        : values;

    return { canceled: false, formValues };
  }
}

export class MessageFormData {
  title() {
    return this;
  }
  body() {
    return this;
  }
  button1() {
    return this;
  }
  button2() {
    return this;
  }
  async show() {
    return { canceled: true, cancelationReason: FormCancelationReason.UserClosed };
  }
}

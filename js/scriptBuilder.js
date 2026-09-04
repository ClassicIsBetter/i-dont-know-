// ===========================================================
// scriptBuilder.js — "Easy Mode" scripting: a guided, click-to-build
// alternative to typing the event/action language directly. Produces the
// exact same rule array the text language and GameRuntime already use —
// this is just a friendlier way to build it.
// ===========================================================
import { EVENT_TYPES } from './scripting.js';
import { EVENT_LABELS, ACTION_SCHEMA, buildAction } from './scriptLang.js';
import { el } from './utils.js';

function defaultParamValues(actionType) {
  return ACTION_SCHEMA[actionType].params.map(p => {
    if (p.type === 'number') return 0;
    if (p.type === 'boolean') return 'true';
    if (p.type === 'color') return '#8a8f98';
    return '';
  });
}

/**
 * Renders the guided builder into `container` for the given `rules`
 * array (mutated in place), calling `onChange(rules)` after every edit
 * so the caller can persist it (and keep any text-mode source in sync).
 */
export function renderScriptBuilder(container, rules, onChange) {
  container.innerHTML = '';
  const rerender = () => renderScriptBuilder(container, rules, onChange);

  if (rules.length === 0) {
    container.appendChild(el('p', 'script-builder-prompt', 'Pick an event to start the script'));
    container.appendChild(buildPicker(EVENT_TYPES.map(e => ({ id: e, label: EVENT_LABELS[e] || e })), (eventName) => {
      rules.push({ event: eventName, actions: [] });
      onChange(rules);
      rerender();
    }));
    return;
  }

  const list = el('div', 'script-builder-list');
  rules.forEach((rule, ruleIndex) => list.appendChild(renderRuleBlock(rule, ruleIndex)));
  container.appendChild(list);

  const addTriggerBtn = el('button', 'btn btn-ghost btn-sm', '+ Add another trigger');
  const addTriggerPicker = buildPicker(EVENT_TYPES.map(e => ({ id: e, label: EVENT_LABELS[e] || e })), (eventName) => {
    rules.push({ event: eventName, actions: [] });
    onChange(rules);
    rerender();
  });
  addTriggerPicker.classList.add('hidden');
  addTriggerBtn.addEventListener('click', () => addTriggerPicker.classList.toggle('hidden'));
  container.appendChild(addTriggerBtn);
  container.appendChild(addTriggerPicker);

  // ---------------------------------------------------------
  function renderRuleBlock(rule, ruleIndex) {
    const block = el('div', 'script-builder-block');

    const header = el('div', 'script-builder-block-header');
    header.appendChild(el('span', 'script-builder-when', `When ${EVENT_LABELS[rule.event] || rule.event}`));
    const removeBlockBtn = el('button', 'script-builder-remove', '✕');
    removeBlockBtn.title = 'Remove this trigger';
    removeBlockBtn.addEventListener('click', () => {
      rules.splice(ruleIndex, 1);
      onChange(rules);
      rerender();
    });
    header.appendChild(removeBlockBtn);
    block.appendChild(header);

    if (rule.actions.length === 0) {
      block.appendChild(el('p', 'script-builder-prompt small', 'Pick an action'));
      block.appendChild(buildPicker(
        Object.entries(ACTION_SCHEMA).map(([id, schema]) => ({ id, label: schema.label })),
        (actionType) => {
          rule.actions.push(buildAction(actionType, defaultParamValues(actionType)));
          onChange(rules);
          rerender();
        }
      ));
      return block;
    }

    const actionsList = el('div', 'script-builder-actions');
    rule.actions.forEach((action, actionIndex) => actionsList.appendChild(renderActionRow(rule, action, actionIndex)));
    block.appendChild(actionsList);

    const addActionBtn = el('button', 'btn btn-ghost btn-sm', '+ Add another action');
    const addActionPicker = buildPicker(
      Object.entries(ACTION_SCHEMA).map(([id, schema]) => ({ id, label: schema.label })),
      (actionType) => {
        rule.actions.push(buildAction(actionType, defaultParamValues(actionType)));
        onChange(rules);
        rerender();
      }
    );
    addActionPicker.classList.add('hidden');
    addActionBtn.addEventListener('click', () => addActionPicker.classList.toggle('hidden'));
    block.appendChild(addActionBtn);
    block.appendChild(addActionPicker);

    return block;
  }

  function renderActionRow(rule, action, actionIndex) {
    const schema = ACTION_SCHEMA[action.type] || { label: action.type, params: [] };
    const row = el('div', 'script-builder-action-row');
    row.appendChild(el('span', 'script-builder-action-name', schema.label));

    schema.params.forEach((param) => {
      let input;
      if (param.type === 'boolean') {
        input = document.createElement('select');
        ['true', 'false'].forEach(v => {
          const opt = document.createElement('option');
          opt.value = v; opt.textContent = v;
          input.appendChild(opt);
        });
        input.value = String(action[param.name] ?? 'true');
      } else if (param.type === 'color') {
        input = document.createElement('input');
        input.type = 'color';
        input.value = /^#[0-9a-fA-F]{6}$/.test(action[param.name]) ? action[param.name] : '#8a8f98';
      } else {
        input = document.createElement('input');
        input.type = param.type === 'number' ? 'number' : 'text';
        if (param.placeholder) input.placeholder = param.placeholder;
        input.value = action[param.name] ?? '';
      }
      input.addEventListener('change', () => {
        const values = schema.params.map(p => p === param ? input.value : (action[p.name] ?? ''));
        Object.assign(action, buildAction(action.type, values));
        onChange(rules);
      });
      row.appendChild(input);
    });

    const removeBtn = el('button', 'script-builder-remove', '✕');
    removeBtn.title = 'Remove this action';
    removeBtn.addEventListener('click', () => {
      rule.actions.splice(actionIndex, 1);
      onChange(rules);
      rerender();
    });
    row.appendChild(removeBtn);
    return row;
  }

  function buildPicker(options, onPick) {
    const wrap = el('div', 'script-builder-picker');
    options.forEach(({ id, label }) => {
      const opt = el('button', 'script-builder-picker-opt', label);
      opt.addEventListener('click', () => onPick(id));
      wrap.appendChild(opt);
    });
    return wrap;
  }
}

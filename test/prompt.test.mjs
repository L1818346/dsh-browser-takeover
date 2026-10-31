/**
 * prompt.test.mjs — 系统提示段的注册契约。
 *
 * 这一段是"Agent 先查清单"的落点，一旦名字/顺序/文本被改坏，功能会静默失效，
 * 所以钉死形状：名字、有限 order、不插值、文本里同时提到两个工具。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ROUTING_SECTION_NAME, ROUTING_TEXT, registerRoutingSection } from '../src/prompt.js';

test('registerRoutingSection 把段落注册到 systemPrompt', () => {
  const calls = [];
  const scope = { systemPrompt: { section(section) { calls.push(section); return () => {}; } } };

  const dispose = registerRoutingSection(scope);

  assert.equal(calls.length, 1);
  const section = calls[0];
  assert.equal(section.name, ROUTING_SECTION_NAME);
  assert.equal(typeof section.order, 'number');
  assert.ok(Number.isFinite(section.order));
  assert.equal(section.interpolate, false);
  assert.match(section.text, /web_sites/);
  assert.match(section.text, /web_open/);
  assert.match(section.text, /remember/);
  assert.match(section.text, /launch/);
  assert.equal(typeof dispose, 'function');
});

test('没有 systemPrompt 时安静跳过（纯 CLI 宿主）', () => {
  for (const scope of [undefined, null, {}, { systemPrompt: {} }, { systemPrompt: { section: 1 } }]) {
    const dispose = registerRoutingSection(scope);
    assert.equal(typeof dispose, 'function');
    assert.doesNotThrow(() => dispose());
  }
});

test('文本不引用 {{变量}}（interpolate:false 下变量不会被替换）', () => {
  assert.equal(/\{\{/.test(ROUTING_TEXT), false);
});

import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

// Runs against the same local fixture as the playback and remote regressions.
export async function checkTvMotion({ call, evaluate, until, activate, focus, press }) {
  const first = '.tv-catalogue-grid .title-card > button';
  const opener = '[aria-label="Details for Example movie 1"]';
  assert.notEqual(await evaluate('getComputedStyle(document.querySelector(".title-card")).transitionDuration'), '0s', 'TV focus transitions are enabled');
  await focus(first);
  for (let index = 0; index < 4; index++) await press('ArrowRight');
  for (let index = 0; index < 4; index++) await press('ArrowLeft');
  assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'), 'Details for Example movie 1', 'Rapid navigation returns to the first card during transitions');
  await delay(350);
  assert.ok(await evaluate('new DOMMatrix(getComputedStyle(document.querySelector(".title-card")).transform).a > 1'), 'Focused poster lifts and scales');
  assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Focused cards do not introduce horizontal overflow');

  await activate(opener);
  await until('!!document.querySelector("dialog button.bg-orange-600:not(:disabled)")');
  await delay(350);
  // Dismiss twice within the same frame: it must stay modal, then restore once.
  await evaluate(`(() => {
    const dialog = document.querySelector('dialog');
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
  })()`);
  assert.ok(await evaluate('!!document.querySelector("dialog[open][data-tv-closing]")'), 'Dismissal retains the modal during its exit');
  assert.ok(await evaluate('document.documentElement.style.overflow === "hidden"'), 'Background stays locked until exit completes');
  await until('!document.querySelector("dialog")');
  assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'), 'Details for Example movie 1', 'Exit restores focus to the opener');
  assert.notEqual(await evaluate('document.documentElement.style.overflow'), 'hidden', 'Exit restores page scrolling');

  await activate('details summary');
  await until('document.querySelector("details").getAnimations().length === 0');
  assert.ok(await evaluate('document.querySelector("details").open'), 'Disclosure opens with native semantics');
  await focus('details button');
  await press('Escape');
  assert.equal(await evaluate('document.querySelector("details").open'), false, 'Back animates and closes a disclosure');
  assert.equal(await evaluate('document.activeElement.tagName'), 'SUMMARY', 'Collapsing a disclosure restores summary focus');
  await evaluate(`(() => {
    const summary = document.querySelector('details summary');
    summary.click(); summary.click(); summary.click();
  })()`);
  await until('document.querySelector("details").getAnimations().length === 0');
  assert.ok(await evaluate('document.querySelector("details").open && !document.querySelector("details").style.height'), 'Rapid disclosure reversals settle without a fixed height');
  await press('Escape');

  await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await focus(first);
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".title-card")).animationName'), 'none');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".title-card")).transitionDuration'), '0s');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".title-card")).transform'), 'none', 'Reduced motion removes poster scaling');
  await activate(opener);
  await until('!!document.querySelector("dialog button.bg-orange-600:not(:disabled)")');
  assert.equal(await evaluate('getComputedStyle(document.querySelector("dialog")).animationName'), 'none');
  await press('Escape');
  assert.equal(await evaluate('!!document.querySelector("dialog")'), false, 'Reduced motion dismisses immediately');
  await activate('details summary');
  assert.equal(await evaluate('document.querySelector("details").getAnimations().length'), 0, 'Reduced motion bypasses disclosure animation');
  await press('Escape');
  await call('Emulation.setEmulatedMedia', { features: [] });
  await evaluate('window.scrollTo({ top: 0, behavior: "auto" })');
}

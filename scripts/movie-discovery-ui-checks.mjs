import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export async function checkMovieDiscovery({ call, evaluate, until, activate, focus, press, resize, origin, fixture, output }) {
  await resize(1280, 720);
  await call('Page.navigate', { url: `${origin}/?tv=1` });
  await until('!!document.querySelector(".media-profile-grid button")');
  await activate('.media-profile-grid button');
  await until('!!document.querySelector("[data-discovery-open]")');
  fixture.delay = 1500;
  await activate('[data-discovery-open]');
  await until('!!document.querySelector(".discovery-loader-ring")');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".discovery-loader-ring")).animationName'), 'discovery-spin', 'Loading visibly animates');
  assert.equal(await evaluate('document.querySelectorAll(".discovery-loader-dots i").length'), 3);
  await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".discovery-loader-ring")).animationName'), 'none', 'Reduced motion disables the spinner');
  await call('Emulation.setEmulatedMedia', { features: [] });
  const loadingScreenshot = await call('Page.captureScreenshot', { format: 'png' });
  writeFileSync(resolve(output, 'discovery-loading.png'), Buffer.from(loadingScreenshot.data, 'base64'));
  await until('document.querySelectorAll("[data-discovery-choice]").length === 4');
  fixture.delay = 0;
  await until('document.activeElement?.hasAttribute("data-discovery-skip")');
  assert.equal(await evaluate('!!document.querySelector(".tv-catalogue-grid")'), false, 'Discovery replaces the catalogue');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".tv-footer")).display'), 'none');
  await until('document.querySelector(".discovery-card")?.textContent.includes("IMDb 8.1/10")');
  for (const [width, height] of [[1280, 720], [1920, 1080], [960, 540]]) {
    await resize(width, height);
    const layout = await evaluate(`(() => {
      const cards = [...document.querySelectorAll('.discovery-card')].map(card => card.getBoundingClientRect());
      const skip = document.querySelector('[data-discovery-skip]').getBoundingClientRect();
      return { cards: cards.map(card => card.toJSON()), skip: skip.toJSON(), width: innerWidth, scrollWidth: document.documentElement.scrollWidth, fits: cards.length === 4 && cards.every((card, index) => Math.abs(card.top - cards[0].top) < 1 && (!index || cards[index - 1].right < card.left))
        && cards[1].right < skip.left && skip.right < cards[2].left && Math.abs((skip.left + skip.right) / 2 - document.documentElement.clientWidth / 2) < 2
        && document.documentElement.scrollWidth <= innerWidth };
    })()`);
    assert.ok(layout.fits, `Four cards and a centered skip button fit at ${width}: ${JSON.stringify(layout)}`);
    if (width >= 1280) {
      assert.ok(await evaluate('document.querySelector(".discovery-card").getBoundingClientRect().bottom <= innerHeight'), `Both actions visible without scrolling at ${width}`);
      const longContentBottom = await evaluate(`(() => {
        const heading = document.querySelector('.discovery-card h2');
        const overview = document.querySelector('.discovery-overview');
        const original = [heading.textContent, overview.textContent];
        heading.textContent = 'A Very Long Movie Title: An Unexpected Journey Across the World';
        overview.textContent = 'Two unlikely friends set out on a journey across the world, uncovering a mystery that will change their lives forever. Along the way they must decide what matters most and find their way home.';
        const bottom = document.querySelector('.discovery-card').getBoundingClientRect().bottom;
        [heading.textContent, overview.textContent] = original;
        return bottom;
      })()`);
      assert.ok(longContentBottom <= height, `Long titles and descriptions keep Watch now visible at ${width}: bottom ${longContentBottom}`);
      const screenshot = await call('Page.captureScreenshot', { format: 'png' });
      writeFileSync(resolve(output, `discovery-${width}.png`), Buffer.from(screenshot.data, 'base64'));
    }
  }
  await resize(1280, 720);
  await focus('[data-discovery-choice]');
  await press('ArrowRight');
  assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'), "I'm more interested in Discovery movie 2");
  await press('ArrowRight');
  assert.equal(await evaluate('document.activeElement.hasAttribute("data-discovery-skip")'), true, 'D-pad reaches the middle skip button');
  await press('ArrowRight');
  assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'), "I'm more interested in Discovery movie 3");
  await press('ArrowRight');
  assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'), "I'm more interested in Discovery movie 4");
  await focus('.discovery-card:nth-child(2) [data-discovery-choice]');
  await press('Enter');
  await until('document.querySelector(".discovery-card h2")?.textContent === "Discovery movie 5"');
  await until('document.activeElement?.hasAttribute("data-discovery-skip")');
  assert.equal(fixture.requests.length, 1, 'One group selection does not call Gemini');
  await activate('[data-discovery-skip]');
  await until('document.querySelector(".discovery-card h2")?.textContent === "Discovery movie 9"');
  await until('document.activeElement?.hasAttribute("data-discovery-skip")');
  assert.equal(fixture.requests.length, 1, 'Skipping uses the next four movies from the same batch');
  await activate('[data-discovery-choice]');
  fixture.fail = true;
  fixture.delay = 500;
  await activate('[data-discovery-choice]');
  await until('!!document.querySelector(".discovery-loader-ring")');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".discovery-loader-ring")).animationName'), 'discovery-spin', 'Refining the next batch also animates');
  await until('!!document.querySelector(".movie-discovery [role=alert]")');
  assert.deepEqual(fixture.requests[1].choices, [2, null, 9, 13]);
  fixture.fail = false;
  fixture.delay = 0;
  await evaluate('[...document.querySelectorAll("button")].find(button => button.textContent === "Try again").click()');
  await until('document.querySelector(".discovery-card h2")?.textContent === "Discovery movie 21"');
  await until('document.activeElement?.hasAttribute("data-discovery-skip")');
  assert.deepEqual(fixture.requests[1], fixture.requests[2], 'Retry retains preferences and skips');
  assert.equal(await evaluate('/round|score|4 of|16 movies/i.test(document.querySelector(".movie-discovery").textContent)'), false, 'Internal rounds remain hidden');
  await press('Escape');
  await until('document.activeElement?.hasAttribute("data-discovery-open")');
  assert.equal(await evaluate('!!document.querySelector(".movie-discovery")'), false);
  fixture.delay = 600;
  await activate('[data-discovery-open]');
  await until('!!document.querySelector(".movie-discovery [role=status]")');
  await press('Escape');
  await delay(700);
  assert.equal(await evaluate('!!document.querySelector(".movie-discovery")'), false, 'Late requests cannot reopen a dismissed page');
  fixture.delay = 0;
  fixture.duplicates = true;
  await activate('[data-discovery-open]');
  await until('document.querySelectorAll("[data-discovery-choice]").length === 4');
  const requestsBeforeChoices = fixture.requests.length;
  for (let group = 0; group < 4; group++) {
    assert.deepEqual(await evaluate('[...document.querySelectorAll(".discovery-card h2")].map(heading => heading.textContent)'), Array(4).fill('Repeated movie'), 'Duplicate cards render in every slot');
    await until('document.activeElement?.hasAttribute("data-discovery-skip")');
    await activate('[data-discovery-choice]');
  }
  await until('document.querySelectorAll("[data-discovery-choice]").length === 4');
  assert.equal(fixture.requests.length, requestsBeforeChoices + 1, 'A repeated batch loads successfully without retrying');
  assert.deepEqual(fixture.requests.at(-1).choices, [1, 1, 1, 1], 'Repeated movie selections can refine the next batch');
  await activate('.discovery-watch');
  await until(`!!document.querySelector('[aria-label="Watch title"]')`);
  assert.equal(await evaluate('!!document.querySelector(".movie-discovery")'), false, 'Watch now opens the existing automatic playback flow');
  await call('Page.navigate', { url: `${origin}/?tv=0` });
  await until('!!document.querySelector("aside")');
  await evaluate('[...document.querySelectorAll("nav button")].find(button => button.textContent.includes("TV & Movies")).click()');
  await until('!!document.querySelector(".tv-catalogue-grid")');
  assert.equal(await evaluate('!!document.querySelector("[data-discovery-open]")'), false, 'Desktop stays unchanged');
}

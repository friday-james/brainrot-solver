import puppeteer from 'puppeteer';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const browser = await puppeteer.launch({
    headless: false,
    args: [
      '--window-size=820,500',
      '--autoplay-policy=no-user-gesture-required',
      '--no-sandbox',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 800, height: 450 });

  console.log('Navigating to game...');
  await page.goto('https://aresgd.github.io/brainrot-mayhem/', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });

  console.log('Waiting for game canvas...');
  await page.waitForSelector('#gameCanvas');
  await page.waitForFunction(() => typeof game !== 'undefined' && typeof update === 'function', {
    timeout: 15000,
  });
  await new Promise(r => setTimeout(r, 1500));

  // Forward bot console messages
  let winHandled = false;
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('[BOT')) console.log(text);
    if (text.includes('[BOT] WIN!') && !winHandled) {
      winHandled = true;
      console.log('\nBot won the game! Taking screenshot...');
      setTimeout(async () => {
        const screenshotPath = join(__dirname, '..', 'win-screenshot.png');
        await page.screenshot({ path: screenshotPath });
        console.log(`Screenshot saved to: ${screenshotPath}`);
        await browser.close();
        process.exit(0);
      }, 2000);
    }
  });

  console.log('Injecting bot...');
  const botCode = readFileSync(join(__dirname, 'bot-inject.js'), 'utf-8');
  await page.evaluate(botCode);

  console.log('Bot is running! Watch the browser window.');
  console.log('Press Ctrl+C to stop.');

  process.on('SIGINT', async () => {
    console.log('\nStopping bot...');
    await browser.close();
    process.exit(0);
  });

  await new Promise(() => {});
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

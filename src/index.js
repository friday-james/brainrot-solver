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
  // Wait for game.js to fully execute and game globals to be available
  await page.waitForFunction(() => typeof game !== 'undefined' && typeof update === 'function', {
    timeout: 15000,
  });
  // Small extra delay for image assets
  await new Promise(r => setTimeout(r, 1500));

  // Forward browser console to Node.js terminal
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('[BOT')) {
      console.log(text);
    }
  });

  console.log('Injecting bot...');
  const botCode = readFileSync(join(__dirname, 'bot-inject.js'), 'utf-8');
  await page.evaluate(botCode);

  console.log('Bot is running! Watch the browser window.');
  console.log('Press Ctrl+C to stop.');

  // Keep the process alive; clean exit on SIGINT
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

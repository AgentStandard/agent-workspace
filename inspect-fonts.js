/* eslint-disable @typescript-eslint/no-require-imports */
const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  
  console.log('Navigating to http://localhost:3000...');
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle2' });
  
  console.log('Waiting for page to load...');
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  const results = await page.evaluate(() => {
    const result = {
      chatMessage: null,
      inputElement: null,
      fonts: [],
      fontChecks: {},
      allElements: []
    };
    
    // Try multiple selectors for chat messages
    const chatSelectors = [
      '.chat-message',
      '[class*="message"]',
      '[class*="chat"]',
      '[class*="Message"]',
      '[class*="Chat"]',
      'div[role="log"] > div',
      '.message-body',
      '.text-sm'
    ];
    
    let chatMessage = null;
    for (const selector of chatSelectors) {
      chatMessage = document.querySelector(selector);
      if (chatMessage && chatMessage.textContent.trim()) {
        break;
      }
    }
    
    if (chatMessage) {
      const styles = window.getComputedStyle(chatMessage);
      result.chatMessage = {
        selector: chatMessage.className || chatMessage.tagName,
        textContent: chatMessage.textContent.substring(0, 50),
        fontFamily: styles.fontFamily,
        fontSize: styles.fontSize,
        lineHeight: styles.lineHeight,
        webkitFontSmoothing: styles.webkitFontSmoothing || styles['-webkit-font-smoothing']
      };
    }
    
    // Try multiple selectors for input
    const inputSelectors = ['input[type="text"]', 'textarea', 'input', '[contenteditable="true"]'];
    let input = null;
    for (const selector of inputSelectors) {
      input = document.querySelector(selector);
      if (input) break;
    }
    
    if (input) {
      const styles = window.getComputedStyle(input);
      result.inputElement = {
        selector: input.tagName + (input.className ? '.' + input.className.split(' ')[0] : ''),
        fontFamily: styles.fontFamily,
        fontSize: styles.fontSize,
        lineHeight: styles.lineHeight,
        webkitFontSmoothing: styles.webkitFontSmoothing || styles['-webkit-font-smoothing']
      };
    }
    
    // List all visible text elements for debugging
    const allDivs = document.querySelectorAll('div, p, span, input, textarea');
    result.allElements = Array.from(allDivs)
      .filter(el => el.textContent && el.textContent.trim().length > 0)
      .slice(0, 10)
      .map(el => ({
        tag: el.tagName,
        class: el.className,
        text: el.textContent.substring(0, 30)
      }));
    
    // Get fonts containing 'Zpix' or 'Press'
    result.fonts = Array.from(document.fonts)
      .filter(f => f.family.includes('Zpix') || f.family.includes('Press'))
      .map(f => ({ family: f.family, status: f.status }));
    
    // Font checks
    result.fontChecks = {
      'Zpix20260307': document.fonts.check('12px "Zpix20260307"'),
      'Zpix': document.fonts.check('12px "Zpix"')
    };
    
    return result;
  });
  
  console.log('\n=== INSPECTION RESULTS ===\n');
  console.log(JSON.stringify(results, null, 2));
  
  await browser.close();
})();

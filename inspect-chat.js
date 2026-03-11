/* eslint-disable @typescript-eslint/no-require-imports */
const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  
  console.log('Navigating to http://localhost:3000...');
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle2' });
  
  console.log('Waiting for page load...');
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  // Take screenshot for visual inspection
  await page.screenshot({ path: 'page-screenshot.png' });
  console.log('Screenshot saved to page-screenshot.png');
  
  const results = await page.evaluate(() => {
    const result = {
      chatMessageBody: null,
      inputElement: null,
      fonts: [],
      zpixCheck: null,
      zpix20260307Check: null,
      visualAppearance: 'Unable to determine programmatically',
      allElements: []
    };
    
    // Try multiple selectors for chat messages
    const chatSelectors = [
      '[class*="chat"] [class*="message"]',
      '.chat-message',
      '[data-message]',
      '.message-body',
      '[class*="Message"]',
      '[class*="ChatPanel"] p',
      '[class*="ChatPanel"] div',
      '[class*="chat-panel"] p',
      '[class*="chat-panel"] div',
      'p',
      'div[class*="text"]'
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
      result.chatMessageBody = {
        element: chatMessage.tagName + (chatMessage.className ? '.' + chatMessage.className.split(' ').join('.') : ''),
        textContent: chatMessage.textContent.substring(0, 50),
        fontFamily: styles.fontFamily,
        fontSize: styles.fontSize,
        lineHeight: styles.lineHeight,
        webkitFontSmoothing: styles.webkitFontSmoothing || styles.getPropertyValue('-webkit-font-smoothing')
      };
    }
    
    // Try multiple selectors for input
    const inputSelectors = [
      'input[type="text"]',
      'textarea',
      '[contenteditable="true"]',
      'input',
      '[class*="input"]'
    ];
    
    let input = null;
    for (const selector of inputSelectors) {
      input = document.querySelector(selector);
      if (input) break;
    }
    
    if (input) {
      const styles = window.getComputedStyle(input);
      result.inputElement = {
        element: input.tagName + (input.className ? '.' + input.className.split(' ').join('.') : ''),
        fontFamily: styles.fontFamily,
        fontSize: styles.fontSize,
        lineHeight: styles.lineHeight,
        webkitFontSmoothing: styles.webkitFontSmoothing || styles.getPropertyValue('-webkit-font-smoothing')
      };
    }
    
    // List all elements for debugging
    result.allElements = Array.from(document.querySelectorAll('*'))
      .filter(el => el.textContent && el.textContent.trim().length > 0 && el.children.length === 0)
      .slice(0, 20)
      .map(el => ({
        tag: el.tagName,
        class: el.className,
        text: el.textContent.substring(0, 30)
      }));
    
    // Get fonts
    result.fonts = Array.from(document.fonts)
      .filter(f => f.family.includes('Zpix') || f.family.includes('Press'))
      .map(f => ({
        family: f.family,
        status: f.status
      }));
    
    // Font checks
    result.zpixCheck = document.fonts.check('12px "Zpix"');
    result.zpix20260307Check = document.fonts.check('12px "Zpix20260307"');
    
    return result;
  });
  
  console.log('\n=== INSPECTION RESULTS ===\n');
  console.log('Chat Message Body:', JSON.stringify(results.chatMessageBody, null, 2));
  console.log('\nInput Element:', JSON.stringify(results.inputElement, null, 2));
  console.log('\nAll Text Elements (first 20):', JSON.stringify(results.allElements, null, 2));
  console.log('\nFonts (Zpix/Press):', JSON.stringify(results.fonts, null, 2));
  console.log('\ndocument.fonts.check(\'12px "Zpix"\'):', results.zpixCheck);
  console.log('document.fonts.check(\'12px "Zpix20260307"\'):', results.zpix20260307Check);
  console.log('\nVisual Appearance:', results.visualAppearance);
  
  await browser.close();
})();

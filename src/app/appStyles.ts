const STYLE = `
  .pg-app-root {
    background: #0b0f14;
    color: #d7dee3;
    min-height: 100vh;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  .pg-app-root * { box-sizing: border-box; }
  .pg-app-topbar {
    display: flex;
    justify-content: flex-end;
    padding: 12px 16px 0;
    font-size: 13px;
  }
  .pg-app-topbar a {
    color: #8fa0ad;
    text-decoration: none;
    padding: 6px 4px;
  }
  .pg-app-topbar a:hover { color: #d7dee3; }
  .pg-app-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 24px 20px 8px;
    text-align: center;
    max-width: 480px;
    margin: 0 auto;
    width: 100%;
  }
  .pg-app-bottombar {
    display: flex;
    justify-content: center;
    padding: 8px 16px 20px;
    font-size: 13px;
  }
  .pg-app-bottombar a {
    color: #8fa0ad;
    text-decoration: none;
  }
  .pg-app-bottombar a:hover { color: #d7dee3; }
  .pg-headline {
    font-size: 22px;
    font-weight: 600;
    margin: 0 0 12px;
    line-height: 1.4;
  }
  .pg-line {
    font-size: 16px;
    color: #b7c2cc;
    margin: 0 0 8px;
    line-height: 1.5;
  }
  .pg-btn {
    appearance: none;
    border: none;
    border-radius: 14px;
    padding: 16px 28px;
    font-size: 17px;
    font-weight: 600;
    cursor: pointer;
    width: 100%;
    max-width: 320px;
    margin-top: 10px;
    font-family: inherit;
  }
  .pg-btn-primary {
    background: #7fd1c9;
    color: #0b0f14;
  }
  .pg-btn-primary:hover { background: #93dad3; }
  .pg-btn-primary:disabled {
    background: #2a3540;
    color: #6b7885;
    cursor: default;
  }
  .pg-btn-secondary {
    background: transparent;
    color: #b7c2cc;
    border: 1px solid #33465a;
    transition: opacity 0.6s ease, border-color 0.6s ease, color 0.6s ease;
  }
  .pg-btn-secondary:hover { background: #131b23; }
  .pg-btn-secondary:disabled {
    opacity: 0.12;
    border-color: #1c2733;
    color: #3a4550;
    cursor: default;
  }
  .pg-btn-secondary:disabled:hover { background: transparent; }
  .pg-btn-link {
    background: transparent;
    color: #8fa0ad;
    border: none;
    font-size: 14px;
    padding: 8px;
    width: auto;
    cursor: pointer;
    font-family: inherit;
  }
  .pg-btn-link:hover { color: #d7dee3; }
  .pg-suds-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 10px;
    width: 100%;
    max-width: 340px;
    margin: 20px auto;
  }
  .pg-suds-btn {
    appearance: none;
    border: 1px solid #33465a;
    background: #131b23;
    color: #d7dee3;
    border-radius: 12px;
    padding: 16px 0;
    font-size: 18px;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
  }
  .pg-suds-btn:hover { background: #1c2733; }
  .pg-suds-label {
    font-size: 13px;
    color: #8fa0ad;
    display: flex;
    justify-content: space-between;
    width: 100%;
    max-width: 340px;
    margin: 0 auto;
  }
  .pg-flag-list {
    width: 100%;
    max-width: 340px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin: 20px auto;
  }
  .pg-flag-btn {
    appearance: none;
    border: 1px solid #33465a;
    background: #131b23;
    color: #d7dee3;
    border-radius: 12px;
    padding: 14px 16px;
    font-size: 15px;
    text-align: center;
    cursor: pointer;
    font-family: inherit;
  }
  .pg-flag-btn.pg-selected {
    border-color: #7fd1c9;
    background: #15252a;
  }
  .pg-indicator {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #2a3540;
    margin: 0 auto 18px;
    transition: background 0.6s ease;
  }
  .pg-indicator.pg-face-ok { background: #4d7a72; }
  .pg-hint {
    font-size: 13px;
    color: #8fa0ad;
    min-height: 18px;
    margin-bottom: 8px;
  }
  .pg-breathing-ring-wrap {
    width: 180px;
    height: 180px;
    display: flex;
    align-items: center;
    justify-content: center;
    /* Bottom margin is sized for the ring's max inflated scale (see
       renderBreathing's applyPhase) so it can never visually overlap the
       Finish button below it, on any screen size — a CSS transform grows
       the ring past its box without pushing sibling layout, so this has
       to be accounted for with real spacing, not by chance. */
    margin: 16px auto 56px;
    position: relative;
  }
  .pg-breathing-ring {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    border: 3px solid #5a7a86;
  }
  .pg-breathing-label {
    font-size: 20px;
    color: #d7dee3;
    z-index: 1;
  }
  .pg-grounding-count {
    font-size: 15px;
    color: #7fd1c9;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin-bottom: 8px;
  }
  .pg-privacy-note {
    font-size: 12px;
    color: #6b7885;
    max-width: 320px;
    margin: 24px auto 0;
    line-height: 1.5;
  }
  .pg-tel-link {
    display: block;
    text-decoration: none;
  }
`;

let injected = false;

export function ensureAppStylesInjected(): void {
  if (injected) return;
  injected = true;
  const style = document.createElement("style");
  style.textContent = STYLE;
  document.head.appendChild(style);
}

import { registerRootComponent } from 'expo';

import App from './App';

// Поддержка «рамки телефона» при просмотре в браузере (телефон не трогается).
// На Android-устройстве document не существует, поэтому блок просто пропускается.
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = `
    html, body { margin: 0; height: 100%; background: #0a0a12; overflow: hidden; }
    #root {
      display: block !important;
      height: 892px !important;
      width: 412px;
      max-width: 100%;
      margin: 0 auto;
      margin-top: 20px;
      background: #14141d;
      box-shadow: 0 0 40px rgba(124, 108, 240, 0.25);
      overflow-y: auto;
      scrollbar-width: none;
    }
    #root::-webkit-scrollbar { display: none; }
    #root *::-webkit-scrollbar { display: none; }
    #root * { scrollbar-width: none; }

    /* Анимация свечения заголовка — пульсирующее «горение» */
    @keyframes titleGlow {
      0%, 100% {
        text-shadow: 0 0 8px rgba(255,80,80,0.7), 0 0 16px rgba(255,80,80,0.35);
        color: #ff6b6b;
      }
      50% {
        text-shadow: 0 0 18px rgba(255,120,120,1), 0 0 36px rgba(255,80,80,0.55), 0 0 54px rgba(255,60,60,0.25);
        color: #ff9a9a;
      }
    }
    #app-title {
      animation: titleGlow 2.2s ease-in-out infinite;
    }
  `;
  document.head.appendChild(style);
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
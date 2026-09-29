import 'katex/dist/katex.min.css';
import 'highlight.js/styles/atom-one-dark.css';
import '../styles/global.css';

import { initUI } from './ui';
import { initBackground } from './background';
import { initColors } from './colors';
import { initChat } from './chat';

document.addEventListener('DOMContentLoaded', () => {
	initUI();
	initBackground();
	initColors();
	initChat();
});